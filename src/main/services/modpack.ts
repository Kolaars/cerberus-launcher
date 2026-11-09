import AdmZip from 'adm-zip'
import { rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type {
  CatalogSource,
  CatalogVersion,
  ContentInstallResult,
  ContentType,
  CreateInstanceRequest,
  InstallContentRequest,
  InstallKind,
  InstallModpackRequest,
  Instance,
  InstanceContent,
  LoaderType,
  TaskResult
} from '@shared/types'
import { downloadFile } from '../utils/download'
import { ensureDir } from '../utils/fs'
import { formatError } from '../utils/text'
import { log } from '../utils/logger'
import { runPool } from '../utils/pool'
import type { ConfigStore } from './config-store'
import type { InstanceService } from './instances'
import type { CatalogService } from './catalog'
import type { ModLoaderRegistry } from './modloader'
import type { InstallerService } from './minecraft/installer'

interface MrpackIndex {
  formatVersion: number
  game: string
  versionId?: string
  name?: string
  summary?: string
  files: Array<{
    path: string
    hashes?: { sha1?: string; sha512?: string }
    env?: { client?: string; server?: string }
    downloads?: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>
}

interface CurseForgeManifest {
  minecraft: {
    version: string
    modLoaders?: Array<{ id: string; primary: boolean }>
  }
  manifestType?: string
  name?: string
  version?: string
  author?: string
  files?: Array<{ projectID: number; fileID: number; required?: boolean }>
  overrides?: string
}

interface ParsedModpack {
  name: string
  summary: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion: string | null
  archivePath: string
  source: CatalogSource
  projectVersionName: string
  files: Array<{
    relativePath: string
    projectType: Exclude<ContentType, 'modpack'> | null
    projectId: string
    versionId: string
    fileName: string
    url: string
    sha1?: string
    size?: number
  }>
  overrides: Array<{ prefix: string; path: string; data: Buffer }>
  manifestVersion?: string
}

type ProgressEmitter = (progress: import('@shared/types').InstallProgress) => void

export class ContentService {
  constructor(
    private readonly config: ConfigStore,
    private readonly instances: InstanceService,
    private readonly catalog: CatalogService,
    private readonly loaders: ModLoaderRegistry,
    private readonly installer: InstallerService,
    private readonly emitProgress: ProgressEmitter
  ) {}

  get cacheDirectory(): string {
    return join(this.config.get().gameDirectory, '.cerberus-cache')
  }

  async createInstance(request: CreateInstanceRequest): Promise<TaskResult> {
    this.installer.beginExternal()
    let instanceId: string | null = null
    let taskId = `instance-${Date.now().toString(36)}`

    try {
      const loader = request.loader
      const loaderVersion =
        loader === 'vanilla'
          ? null
          : await this.resolveLoaderVersion(loader, request.minecraftVersion, request.loaderVersion)

      const instance = this.instances.create({
        ...request,
        loaderVersion
      })
      instanceId = instance.id

      const vanilla = await this.installer.install(
        request.minecraftVersion,
        instance.id,
        { kind: 'instance', label: instance.name }
      )
      taskId = vanilla.taskId
      if (!vanilla.ok) {
        throw new Error(vanilla.error ?? 'Не удалось установить Minecraft.')
      }

      let launchVersionId = request.minecraftVersion
      if (loader !== 'vanilla' && loaderVersion) {
        const installedLoader = await this.loaders.install(
          loader,
          request.minecraftVersion,
          loaderVersion,
          instance.id,
          { kind: 'instance', label: instance.name }
        )
        launchVersionId = installedLoader.launchVersionId
      }

      this.instances.update(instance.id, {
        launchVersionId,
        loaderVersion
      })

      log.info(
        'instance',
        `Инстанс ${instance.id} готов: ${request.minecraftVersion}, ${loader} ${loaderVersion ?? ''}`
      )
      return {
        taskId,
        versionId: request.minecraftVersion,
        ok: true,
        instanceId: instance.id,
        kind: 'instance'
      }
    } catch (error) {
      if (instanceId) {
        try {
          this.instances.remove(instanceId)
        } catch {
          // Инстанс мог не успеть создаться.
        }
      }
      const message = formatError(error)
      log.error('instance', error)
      return {
        taskId,
        versionId: request.minecraftVersion,
        ok: false,
        error: message,
        instanceId: instanceId ?? undefined,
        kind: 'instance'
      }
    } finally {
      this.installer.endExternal()
    }
  }

  async installModpack(request: InstallModpackRequest): Promise<TaskResult> {
    this.installer.beginExternal()
    let instanceId: string | null = null
    let taskId = `modpack-${Date.now().toString(36)}`
    let minecraftVersion = ''
    let packName = ''

    try {
      const project = await this.catalog.getProject(
        request.source,
        request.projectId,
        'modpack'
      )
      const version = await this.catalog.getVersion(
        request.source,
        request.projectId,
        request.versionId
      )
      const pack = await this.parseModpack(
        request.source,
        request.projectId,
        version,
        project.name,
        request.projectVersionName ?? version.versionNumber
      )
      minecraftVersion = pack.minecraftVersion
      packName = pack.name
      taskId = `modpack-${Date.now().toString(36)}`

      const loaderVersion =
        pack.loader === 'vanilla'
          ? null
          : pack.loaderVersion ??
            (await this.resolveLoaderVersion(pack.loader, pack.minecraftVersion, null))

      const instance = this.instances.create({
        name: pack.name,
        description: pack.summary,
        iconUrl: project.iconUrl,
        minecraftVersion: pack.minecraftVersion,
        loader: pack.loader,
        loaderVersion,
        source: request.source,
        projectId: request.projectId,
        projectVersionId: request.versionId
      })
      instanceId = instance.id
      this.instances.update(instance.id, {
        projectVersionName: request.projectVersionName ?? version.versionNumber
      })

      const vanilla = await this.installer.install(
        pack.minecraftVersion,
        instance.id,
        { kind: 'modpack', label: instance.name }
      )
      taskId = vanilla.taskId
      if (!vanilla.ok) {
        throw new Error(vanilla.error ?? 'Не удалось установить Minecraft для сборки.')
      }

      let launchVersionId = pack.minecraftVersion
      if (pack.loader !== 'vanilla' && loaderVersion) {
        const installedLoader = await this.loaders.install(
          pack.loader,
          pack.minecraftVersion,
          loaderVersion,
          instance.id,
          { kind: 'modpack', label: instance.name }
        )
        launchVersionId = installedLoader.launchVersionId
      }

      const contentItems = await this.installPackFiles(instance, pack, request.versionId)
      this.instances.update(instance.id, {
        launchVersionId,
        loaderVersion
      })
      if (contentItems.length > 0) {
        this.instances.addContent(instance.id, contentItems)
      }

      log.info(
        'modpack',
        `Сборка ${pack.name} (${request.source}) установлена в ${instance.id}: ${contentItems.length} файлов`
      )
      return {
        taskId,
        versionId: pack.minecraftVersion,
        ok: true,
        instanceId: instance.id,
        kind: 'modpack'
      }
    } catch (error) {
      if (instanceId) {
        try {
          this.instances.remove(instanceId)
        } catch {
          // ignore
        }
      }
      const message = formatError(error)
      log.error('modpack', error)
      return {
        taskId,
        versionId: minecraftVersion || packName,
        ok: false,
        error: message,
        instanceId: instanceId ?? undefined,
        kind: 'modpack'
      }
    } finally {
      this.installer.endExternal()
    }
  }

  async installContent(request: InstallContentRequest): Promise<ContentInstallResult> {
    this.installer.beginExternal()
    try {
      const instance = this.instances.get(request.instanceId)
      if (!instance) throw new Error('Инстанс не найден.')
      if (request.projectType === 'mod' && instance.loader === 'vanilla') {
        throw new Error('Для установки модов создайте инстанс с модовым загрузчиком.')
      }

      const project = await this.catalog.getProject(
        request.source,
        request.projectId,
        request.projectType
      )
      const version = await this.catalog.getVersion(
        request.source,
        request.projectId,
        request.versionId
      )
      if (!version.downloadUrl) {
        throw new Error('У выбранной версии нет доступного файла для скачивания.')
      }

      if (
        version.gameVersions.length > 0 &&
        !version.gameVersions.includes(instance.minecraftVersion)
      ) {
        throw new Error(
          `Версия несовместима с Minecraft ${instance.minecraftVersion}. Выберите другую версию.`
        )
      }
      if (
        request.projectType === 'mod' &&
        version.loaders.length > 0 &&
        !version.loaders.includes(instance.loader)
      ) {
        throw new Error(`Мод не поддерживает загрузчик ${instance.loader}.`)
      }

      const folder = contentFolder(request.projectType)
      const fileName = safeFileName(version.fileName || `${request.projectId}.jar`)
      const relativePath = `${folder}/${fileName}`
      const target = safeJoin(this.instances.minecraftDirectory(instance.id), relativePath)
      const taskId = `content-${Date.now().toString(36)}`
      const label = project.name

      const previous = this.instances
        .listContent(instance.id)
        .find(
          (item) =>
            item.projectType === request.projectType &&
            item.projectId === request.projectId &&
            item.source === request.source
        )
      if (previous) {
        try {
          await this.deleteContentFile(instance.id, previous)
          this.instances.removeContentRecord(instance.id, previous.id)
        } catch {
          // Старый файл мог быть удалён вручную.
        }
      }

      this.progress(
        taskId,
        instance.minecraftVersion,
        label,
        `Скачиваем ${project.name}…`,
        0,
        1,
        instance.id,
        'content'
      )
      await downloadFile(version.downloadUrl, target, {
        sha1: version.sha1,
        size: version.fileSize || undefined
      })
      this.progress(
        taskId,
        instance.minecraftVersion,
        label,
        `${project.name} установлен`,
        1,
        1,
        instance.id,
        'content'
      )

      const content: InstanceContent = {
        id: `${request.source}:${request.projectId}:${request.versionId}:${relativePath}`,
        source: request.source,
        projectId: request.projectId,
        projectType: request.projectType,
        name: project.name || request.name || fileName,
        versionId: request.versionId,
        versionNumber: request.versionNumber ?? version.versionNumber,
        fileName,
        relativePath,
        iconUrl: project.iconUrl ?? request.iconUrl,
        installedAt: Date.now()
      }
      this.instances.addContent(instance.id, [content])
      return {
        content,
        instance: this.instances.get(instance.id)!
      }
    } finally {
      this.installer.endExternal()
    }
  }

  async removeContent(instanceId: string, contentId: string): Promise<InstanceContent[]> {
    this.installer.beginExternal()
    try {
      const content = this.instances.listContent(instanceId).find((item) => item.id === contentId)
      if (!content) throw new Error('Установленный контент не найден.')
      await this.deleteContentFile(instanceId, content)
      this.instances.removeContentRecord(instanceId, contentId)
      return this.instances.listContent(instanceId)
    } finally {
      this.installer.endExternal()
    }
  }

  private async installPackFiles(
    instance: Instance,
    pack: ParsedModpack,
    versionId: string
  ): Promise<InstanceContent[]> {
    const root = this.instances.minecraftDirectory(instance.id)
    ensureDir(root)
    const taskId = `content-${Date.now().toString(36)}`
    let done = 0
    const total = Math.max(1, pack.files.length)

    this.progress(
      taskId,
      pack.minecraftVersion,
      pack.name,
      `Файлы сборки: 0 из ${pack.files.length}`,
      0,
      total,
      instance.id,
      'modpack'
    )

    await runPool(
      pack.files,
      4,
      async (file) => {
        if (!file.url) {
          done += 1
          return
        }
        const destination = safeJoin(root, file.relativePath)
        await downloadFile(file.url, destination, {
          sha1: file.sha1,
          size: file.size && file.size > 0 ? file.size : undefined
        })
        done += 1
        this.progress(
          taskId,
          pack.minecraftVersion,
          pack.name,
          `Файлы сборки: ${done} из ${pack.files.length}`,
          done,
          total,
          instance.id,
          'modpack'
        )
      }
    )

    this.progress(
      taskId,
      pack.minecraftVersion,
      pack.name,
      'Применяем overrides…',
      0,
      1,
      instance.id,
      'modpack'
    )
    for (const entry of pack.overrides) {
      const target = safeJoin(root, entry.path)
      ensureDir(dirname(target))
      await writeFile(target, entry.data)
    }

    const now = Date.now()
    const items: InstanceContent[] = []
    pack.files.forEach((file, index) => {
      if (!file.projectType) return
      const relativePath = file.relativePath.replace(/\\/g, '/')
      items.push({
        id: `pack:${pack.source}:${versionId}:${index}:${relativePath}`,
        source: pack.source,
        projectId: file.projectId,
        projectType: file.projectType,
        name: file.fileName.replace(/\.(jar|zip)$/i, ''),
        versionId: file.versionId || versionId,
        versionNumber: file.versionId || pack.manifestVersion || 'из сборки',
        fileName: file.fileName,
        relativePath,
        iconUrl: instance.iconUrl,
        installedAt: now + index
      })
    })

    return items
  }

  private async parseModpack(
    source: CatalogSource,
    projectId: string,
    version: CatalogVersion,
    fallbackName: string,
    versionName: string
  ): Promise<ParsedModpack> {
    if (!version.downloadUrl) throw new Error('У сборки нет файла для скачивания.')
    const extension = source === 'modrinth' ? '.mrpack' : '.zip'
    const archivePath = join(
      this.cacheDirectory,
      'packs',
      `${source}-${projectId}-${version.id}${extension}`
    )

    await downloadFile(version.downloadUrl, archivePath, {
      sha1: version.sha1,
      size: version.fileSize || undefined
    })

    if (source === 'modrinth') {
      return this.parseMrpack(archivePath, fallbackName, versionName, version.id)
    }
    return this.parseCurseForgePack(archivePath, fallbackName, versionName)
  }

  private async parseMrpack(
    archivePath: string,
    fallbackName: string,
    versionName: string,
    versionId: string
  ): Promise<ParsedModpack> {
    const zip = new AdmZip(archivePath)
    const indexEntry = zip.getEntry('modrinth.index.json')
    if (!indexEntry) throw new Error('В .mrpack отсутствует modrinth.index.json.')
    const index = JSON.parse(indexEntry.getData().toString('utf8')) as MrpackIndex
    if (!index?.dependencies?.minecraft) {
      throw new Error('В .mrpack не указана версия Minecraft.')
    }

    const { loader, loaderVersion } = loaderFromModrinthDependencies(index.dependencies)
    const files: ParsedModpack['files'] = []
    for (const file of index.files ?? []) {
      if (file.env?.client === 'unsupported') continue
      const relativePath = safeRelative(file.path)
      if (!relativePath) continue
      const url = (file.downloads ?? []).find((entry) => /^https?:\/\//i.test(entry))
      if (!url) continue
      files.push({
        relativePath,
        projectType: contentFolderFromPath(relativePath),
        projectId: '',
        versionId: '',
        fileName: basename(relativePath),
        url,
        sha1: file.hashes?.sha1,
        size: file.fileSize
      })
    }

    const overrides = readOverrides(zip, ['overrides', 'client-overrides'])
    return {
      name: index.name || fallbackName,
      summary: index.summary ?? 'Сборка Modrinth',
      minecraftVersion: index.dependencies.minecraft,
      loader,
      loaderVersion,
      archivePath,
      source: 'modrinth',
      projectVersionName: versionName,
      files,
      overrides,
      manifestVersion: versionId
    }
  }

  private async parseCurseForgePack(
    archivePath: string,
    fallbackName: string,
    versionName: string
  ): Promise<ParsedModpack> {
    const zip = new AdmZip(archivePath)
    const manifestEntry = zip.getEntry('manifest.json')
    if (!manifestEntry) throw new Error('В архиве CurseForge отсутствует manifest.json.')
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as CurseForgeManifest
    if (!manifest?.minecraft?.version) {
      throw new Error('В manifest.json CurseForge не указана версия Minecraft.')
    }

    const primaryLoader = manifest.minecraft.modLoaders?.find((entry) => entry.primary)
    const { loader, loaderVersion } = primaryLoader
      ? loaderFromCurseForgeId(primaryLoader.id)
      : { loader: 'vanilla' as LoaderType, loaderVersion: null }

    const required = (manifest.files ?? []).filter((file) => file.required !== false)
    const resolved = await this.catalog.resolveCurseForgeFiles(required.map((file) => file.fileID))
    const byId = new Map(resolved.map((file) => [file.id, file]))
    const files: ParsedModpack['files'] = []
    for (const entry of required) {
      const file = byId.get(String(entry.fileID))
      if (!file || !file.downloadUrl) {
        throw new Error(
          `Не удалось получить файл CurseForge ${entry.projectID}/${entry.fileID}. ` +
            'Возможно, автор запретил сторонние загрузки.'
        )
      }
      const fileName = safeFileName(file.fileName)
      files.push({
        relativePath: `mods/${fileName}`,
        projectType: 'mod',
        projectId: String(entry.projectID),
        versionId: String(entry.fileID),
        fileName,
        url: file.downloadUrl,
        sha1: file.sha1,
        size: file.fileSize
      })
    }

    const overrides = readOverrides(zip, [manifest.overrides || 'overrides'])
    return {
      name: manifest.name || fallbackName,
      summary: `CurseForge · ${manifest.author ?? 'неизвестный автор'}`,
      minecraftVersion: manifest.minecraft.version,
      loader,
      loaderVersion,
      archivePath,
      source: 'curseforge',
      projectVersionName: manifest.version || versionName,
      files,
      overrides,
      manifestVersion: manifest.version
    }
  }

  private async resolveLoaderVersion(
    loader: LoaderType,
    minecraftVersion: string,
    requested: string | null | undefined
  ): Promise<string> {
    if (loader === 'vanilla') throw new Error('Vanilla не требует версии загрузчика.')
    if (requested?.trim()) return requested.trim()
    const versions = await this.loaders.listVersions(loader, minecraftVersion)
    const preferred = versions.find((entry) => entry.stable) ?? versions[0]
    if (!preferred) {
      throw new Error(
        `Не найдено версий ${loader} для Minecraft ${minecraftVersion}. Выберите другую версию игры.`
      )
    }
    return preferred.version
  }

  private async deleteContentFile(instanceId: string, content: InstanceContent): Promise<void> {
    const directory = contentDirectory(this.instances.minecraftDirectory(instanceId), content.projectType)
    const target = safeJoin(this.instances.minecraftDirectory(instanceId), content.relativePath)
    const root = resolve(directory)
    const resolvedTarget = resolve(target)
    if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${sep}`)) {
      throw new Error('Некорректный путь установленного контента.')
    }
    await rm(resolvedTarget, { force: true })
  }

  private progress(
    taskId: string,
    versionId: string,
    label: string,
    message: string,
    current: number,
    total: number,
    instanceId: string,
    kind: InstallKind
  ): void {
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0
    this.emitProgress({
      taskId,
      versionId,
      stage: 'content',
      message,
      current,
      total,
      percent,
      instanceId,
      kind,
      label
    })
  }
}

function contentFolder(type: Exclude<ContentType, 'modpack'>): string {
  switch (type) {
    case 'mod':
      return 'mods'
    case 'resourcepack':
      return 'resourcepacks'
    case 'shader':
      return 'shaderpacks'
    default:
      return 'mods'
  }
}

function contentDirectory(minecraftDirectory: string, type: InstanceContent['projectType']): string {
  return join(minecraftDirectory, contentFolder(type))
}

function contentFolderFromPath(
  relativePath: string
): Exclude<ContentType, 'modpack'> | null {
  const normalized = relativePath.replace(/\\/g, '/')
  if (normalized.startsWith('mods/')) return 'mod'
  if (normalized.startsWith('resourcepacks/')) return 'resourcepack'
  if (normalized.startsWith('shaderpacks/')) return 'shader'
  return null
}

function safeRelative(value: string): string | null {
  const normalized = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('\0')) return null
  if (/^[A-Za-z]:/.test(normalized)) return null
  const parts = normalized.split('/')
  if (parts.some((part) => part === '..' || part === '.' || !part)) return null
  return parts.join('/')
}

function safeJoin(root: string, relativePath: string): string {
  const safe = safeRelative(relativePath)
  if (!safe) throw new Error('Некорректный путь файла в сборке.')
  const target = resolve(root, safe)
  const resolvedRoot = resolve(root)
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Файл сборки пытается выйти за пределы инстанса.')
  }
  return target
}

function safeFileName(value: string): string {
  const name = basename(String(value ?? '').replace(/\\/g, '/'))
  if (!name || name === '.' || name === '..' || name.includes('\0')) {
    throw new Error('Некорректное имя файла контента.')
  }
  return name.slice(0, 180)
}

function readOverrides(
  zip: AdmZip,
  prefixes: string[]
): Array<{ prefix: string; path: string; data: Buffer }> {
  const result: Array<{ prefix: string; path: string; data: Buffer }> = []
  const normalizedPrefixes = prefixes
    .map((prefix) => prefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const entryName = entry.entryName.replace(/\\/g, '/')
    for (const prefix of normalizedPrefixes) {
      if (!entryName.startsWith(`${prefix}/`)) continue
      const relative = safeRelative(entryName.slice(prefix.length + 1))
      if (!relative) continue
      result.push({ prefix, path: relative, data: entry.getData() })
      break
    }
  }
  return result
}

function loaderFromModrinthDependencies(dependencies: Record<string, string>): {
  loader: LoaderType
  loaderVersion: string | null
} {
  if (dependencies['fabric-loader']) {
    return { loader: 'fabric', loaderVersion: dependencies['fabric-loader'] }
  }
  if (dependencies['quilt-loader']) {
    return { loader: 'quilt', loaderVersion: dependencies['quilt-loader'] }
  }
  if (dependencies['neoforge']) {
    return { loader: 'neoforge', loaderVersion: dependencies['neoforge'] }
  }
  if (dependencies['forge']) {
    return { loader: 'forge', loaderVersion: dependencies['forge'] }
  }
  return { loader: 'vanilla', loaderVersion: null }
}

function loaderFromCurseForgeId(id: string): {
  loader: LoaderType
  loaderVersion: string | null
} {
  const normalized = id.toLowerCase()
  for (const loader of ['neoforge', 'forge', 'fabric', 'quilt'] as const) {
    if (normalized.startsWith(`${loader}-`)) {
      return { loader, loaderVersion: id.slice(loader.length + 1) }
    }
  }
  return { loader: 'vanilla', loaderVersion: null }
}
