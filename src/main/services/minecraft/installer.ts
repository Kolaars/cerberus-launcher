import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  InstallKind,
  InstallProgress,
  InstallStage,
  TaskResult
} from '@shared/types'
import { downloadFile } from '../../utils/download'
import { ensureDir, readJson } from '../../utils/fs'
import { formatError, isAbortError } from '../../utils/text'
import { log } from '../../utils/logger'
import { runPool } from '../../utils/pool'
import type { TaskManager } from '../../utils/task-manager'
import type { InstanceService } from '../instances'
import type { InstalledService } from './installed'
import { resolveLibraries } from './libraries'
import { prepareNatives } from './natives'
import { createRuleContext } from './rules'
import type { AssetIndexFile, ResolvedNative, ResolvedLibrary, VersionJson } from './types'
import type { VersionManifestService } from './version-manifest'

type ProgressEmitter = (progress: InstallProgress) => void
type DoneEmitter = (result: TaskResult) => void

const LIBRARY_CONCURRENCY = 8
const ASSET_CONCURRENCY = 12

interface InstallContext {
  kind?: InstallKind
  label?: string
}

export class InstallerService {
  private activeTaskId: string | null = null
  private externalBusy = false
  private lastProgressAt = 0
  private activeContext: InstallContext = {}

  constructor(
    private readonly manifest: VersionManifestService,
    private readonly installed: InstalledService,
    private readonly instances: InstanceService,
    private readonly tasks: TaskManager,
    private readonly emitProgress: ProgressEmitter,
    private readonly emitDone: DoneEmitter
  ) {}

  isInstalling(): boolean {
    return this.activeTaskId !== null || this.externalBusy
  }

  /**
   * Захватывает глобальный слот установки для составных операций (модпаки,
   * создание инстанса), которые последовательно вызывают несколько сервисов.
   */
  beginExternal(): void {
    if (this.activeTaskId || this.externalBusy) {
      throw new Error('Уже идёт установка. Дождитесь её завершения или отмените.')
    }
    this.externalBusy = true
  }

  endExternal(): void {
    this.externalBusy = false
  }

  async install(
    versionId: string,
    instanceId?: string,
    context: InstallContext = {}
  ): Promise<TaskResult> {
    if (this.activeTaskId) {
      throw new Error('Уже идёт установка. Дождитесь её завершения или отмените.')
    }
    if (instanceId && !this.instances.exists(instanceId)) {
      throw new Error('Инстанс не найден.')
    }

    const task = this.tasks.create()
    this.activeTaskId = task.id
    this.lastProgressAt = 0
    this.activeContext = {
      kind: context.kind ?? (instanceId ? 'instance' : 'version'),
      label: context.label
    }

    try {
      const entry = await this.manifest.getEntry(versionId)
      this.progress(
        task.id,
        versionId,
        'preparing',
        instanceId ? 'Готовим инстанс…' : 'Получаем сведения о версии…',
        0,
        1,
        instanceId
      )

      const version = await this.manifest.fetchVersionJson(entry)
      const versionDirectory = this.installed.versionDirectory(versionId, instanceId)
      const librariesDirectory = this.installed.librariesDirectory()
      const assetsDirectory = this.installed.assetsDirectory()
      const nativesDirectory = join(versionDirectory, 'natives')
      const versionJsonPath = join(versionDirectory, `${versionId}.json`)
      const clientJarPath = join(versionDirectory, `${versionId}.jar`)

      ensureDir(versionDirectory)
      ensureDir(librariesDirectory)
      ensureDir(join(assetsDirectory, 'indexes'))
      ensureDir(join(assetsDirectory, 'objects'))

      this.progress(
        task.id,
        versionId,
        'version',
        'Скачиваем описание версии…',
        0,
        1,
        instanceId
      )
      await downloadFile(entry.url, versionJsonPath, {
        sha1: entry.sha1,
        signal: task.signal
      })
      this.progress(task.id, versionId, 'version', 'Описание версии готово', 1, 1, instanceId)

      const client = version.downloads?.client
      if (!client) {
        throw new Error('В манифесте нет клиентского JAR для этой версии.')
      }

      this.progress(
        task.id,
        versionId,
        'client',
        'Скачиваем клиент Minecraft…',
        0,
        client.size,
        instanceId
      )
      await downloadFile(client.url, clientJarPath, {
        sha1: client.sha1,
        size: client.size,
        signal: task.signal,
        onProgress: (received, total) => {
          this.progress(
            task.id,
            versionId,
            'client',
            `Клиент Minecraft: ${formatBytes(received)} из ${formatBytes(total)}`,
            received,
            total,
            instanceId
          )
        }
      })
      if (client.size > 0) {
        this.progress(
          task.id,
          versionId,
          'client',
          'Клиент Minecraft готов',
          client.size,
          client.size,
          instanceId
        )
      }

      const ruleContext = createRuleContext()
      const { classpath, natives } = resolveLibraries(version, ruleContext, librariesDirectory)
      const downloads = uniqueByPath<ResolvedLibrary | ResolvedNative>([
        ...classpath,
        ...natives
      ])

      let downloaded = 0
      this.progress(
        task.id,
        versionId,
        'libraries',
        `Библиотеки: 0 из ${downloads.length}`,
        0,
        downloads.length,
        instanceId
      )

      await runPool(
        downloads,
        LIBRARY_CONCURRENCY,
        async (item) => {
          await downloadFile(item.url, item.path, {
            sha1: item.sha1 || undefined,
            size: item.size || undefined,
            signal: task.signal
          })
          downloaded += 1
          this.progress(
            task.id,
            versionId,
            'libraries',
            `Библиотеки: ${downloaded} из ${downloads.length}`,
            downloaded,
            downloads.length,
            instanceId
          )
        },
        task.signal
      )

      await this.installAssets(task.id, versionId, version, assetsDirectory, task.signal, instanceId)

      if (version.logging?.client) {
        const logConfig = version.logging.client
        const logConfigPath = join(assetsDirectory, 'log_configs', logConfig.file.id)
        this.progress(
          task.id,
          versionId,
          'finishing',
          'Скачиваем конфигурацию логирования…',
          0,
          1,
          instanceId
        )
        await downloadFile(logConfig.file.url, logConfigPath, {
          sha1: logConfig.file.sha1,
          size: logConfig.file.size,
          signal: task.signal
        })
        this.progress(task.id, versionId, 'finishing', 'Конфигурация готова', 1, 1, instanceId)
      }

      this.progress(
        task.id,
        versionId,
        'natives',
        'Готовим нативные библиотеки…',
        0,
        Math.max(1, natives.length),
        instanceId
      )
      await prepareNatives(nativesDirectory, natives, (current, total, message) => {
        this.progress(task.id, versionId, 'natives', message, current, total, instanceId)
      })

      this.installed.markInstalled(
        {
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime
        },
        instanceId
      )

      this.progress(task.id, versionId, 'finishing', 'Установка завершена', 1, 1, instanceId)

      const result: TaskResult = {
        taskId: task.id,
        versionId,
        ok: true,
        instanceId,
        kind: this.activeContext.kind
      }
      log.info(
        'installer',
        `Версия ${versionId} установлена${instanceId ? ` в инстанс ${instanceId}` : ''}`
      )
      this.emitDone(result)
      return result
    } catch (error) {
      const cancelled = isAbortError(error)
      if (!cancelled) this.tasks.cancel(task.id)
      const message = cancelled ? 'Установка отменена' : formatError(error)
      if (!cancelled) log.error('installer', error)

      const result: TaskResult = {
        taskId: task.id,
        versionId,
        ok: false,
        cancelled,
        error: message,
        instanceId,
        kind: this.activeContext.kind
      }
      this.emitDone(result)
      return result
    } finally {
      this.tasks.finish(task.id)
      this.activeTaskId = null
      this.activeContext = {}
    }
  }

  cancel(taskId: string): boolean {
    return this.tasks.cancel(taskId)
  }

  private async installAssets(
    taskId: string,
    versionId: string,
    version: VersionJson,
    assetsDirectory: string,
    signal: AbortSignal,
    instanceId?: string
  ): Promise<void> {
    const assetIndex = version.assetIndex
    if (!assetIndex) {
      throw new Error(
        'В описании версии нет индекса ресурсов — такие версии пока не поддерживаются.'
      )
    }

    const indexPath = join(assetsDirectory, 'indexes', `${assetIndex.id}.json`)
    this.progress(
      taskId,
      versionId,
      'assets',
      'Скачиваем индекс ресурсов…',
      0,
      1,
      instanceId
    )
    await downloadFile(assetIndex.url, indexPath, {
      sha1: assetIndex.sha1,
      size: assetIndex.size,
      signal
    })

    const index = readJson<AssetIndexFile>(indexPath)
    if (!index?.objects) {
      throw new Error('Не удалось прочитать индекс ресурсов Minecraft.')
    }
    if (index.map_to_resources) {
      throw new Error(
        'Версии с map_to_resources (очень старые) пока не поддерживаются. ' +
          'Список ограничений есть в README.'
      )
    }

    const objects = Object.entries(index.objects)
    let downloaded = 0
    this.progress(
      taskId,
      versionId,
      'assets',
      `Ресурсы: 0 из ${objects.length}`,
      0,
      objects.length,
      instanceId
    )

    await runPool(
      objects,
      ASSET_CONCURRENCY,
      async ([, object]) => {
        const prefix = object.hash.slice(0, 2)
        const destination = join(assetsDirectory, 'objects', prefix, object.hash)
        const url = `https://resources.download.minecraft.net/${prefix}/${object.hash}`

        await downloadFile(url, destination, {
          sha1: object.hash,
          size: object.size,
          signal
        })

        downloaded += 1
        this.progress(
          taskId,
          versionId,
          'assets',
          `Ресурсы: ${downloaded} из ${objects.length}`,
          downloaded,
          objects.length,
          instanceId
        )
      },
      signal
    )

    if (index.virtual) {
      await this.materializeVirtualAssets(
        taskId,
        versionId,
        assetIndex.id,
        objects,
        assetsDirectory,
        signal,
        instanceId
      )
    }
  }

  private async materializeVirtualAssets(
    taskId: string,
    versionId: string,
    indexId: string,
    objects: Array<[string, { hash: string }]>,
    assetsDirectory: string,
    signal: AbortSignal,
    instanceId?: string
  ): Promise<void> {
    const virtualRoot = join(assetsDirectory, 'virtual', indexId)
    let copied = 0

    this.progress(
      taskId,
      versionId,
      'finishing',
      `Готовим legacy-ресурсы: 0 из ${objects.length}`,
      0,
      objects.length,
      instanceId
    )

    await runPool(
      objects,
      LIBRARY_CONCURRENCY,
      async ([name, object]) => {
        const source = join(assetsDirectory, 'objects', object.hash.slice(0, 2), object.hash)
        const destination = join(virtualRoot, name)
        ensureDir(dirname(destination))
        if (!existsSync(destination)) {
          await copyFile(source, destination)
        }

        copied += 1
        this.progress(
          taskId,
          versionId,
          'finishing',
          `Готовим legacy-ресурсы: ${copied} из ${objects.length}`,
          copied,
          objects.length,
          instanceId
        )
      },
      signal
    )
  }

  private progress(
    taskId: string,
    versionId: string,
    stage: InstallStage,
    message: string,
    current: number,
    total: number,
    instanceId?: string
  ): void {
    const now = Date.now()
    const isFinal = total > 0 && current >= total
    if (!isFinal && now - this.lastProgressAt < 60) return
    this.lastProgressAt = now

    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0
    this.emitProgress({
      taskId,
      versionId,
      stage,
      message,
      current,
      total,
      percent,
      instanceId,
      kind: this.activeContext.kind,
      label: this.activeContext.label
    })
  }
}

function uniqueByPath<T extends { path: string }>(items: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(item.path.toLowerCase(), item)
  }
  return [...map.values()]
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ'
  const megabytes = bytes / (1024 * 1024)
  return `${megabytes.toFixed(megabytes >= 100 ? 0 : 1)} МБ`
}
