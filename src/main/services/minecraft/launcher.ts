import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { delimiter, join } from 'node:path'
import type { Readable } from 'node:stream'
import { app } from 'electron'
import type { LaunchLog, LaunchState } from '@shared/types'
import { evaluateArguments, evaluateLegacyArguments } from './arguments'
import type { AccountStore } from '../account-store'
import type { ConfigStore } from '../config-store'
import type { InstanceService } from '../instances'
import type { JavaService } from '../java'
import type { InstalledService } from './installed'
import { resolveLibraries } from './libraries'
import { resolveVersionProfile } from './profile'
import { createRuleContext } from './rules'
import { readJson, ensureDir } from '../../utils/fs'
import { formatError, splitArgs, stripAnsi } from '../../utils/text'
import { log } from '../../utils/logger'
import { stripUuidDashes } from '../../utils/uuid'
import type { AssetIndexFile, VersionJson } from './types'

type LogEmitter = (line: LaunchLog) => void
type StateEmitter = (state: LaunchState) => void

interface LaunchTarget {
  versionId: string
  instanceId?: string
  gameDirectory: string
  versionsDirectory: string
  fallbackVersionsDirectory?: string
  librariesDirectories: string[]
  assetsDirectory: string
}

export class GameLauncher {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null
  private state: LaunchState = { status: 'idle' }
  private pendingLaunch: Promise<void> | null = null
  private startedAt = 0

  constructor(
    private readonly config: ConfigStore,
    private readonly installed: InstalledService,
    private readonly instances: InstanceService,
    private readonly accounts: AccountStore,
    private readonly java: JavaService,
    private readonly emitLog: LogEmitter,
    private readonly emitState: StateEmitter
  ) {}

  getState(): LaunchState {
    return { ...this.state }
  }

  async launch(versionId: string, instanceId?: string): Promise<void> {
    if (this.process || this.pendingLaunch) {
      throw new Error('Игра уже запущена или запускается. Дождитесь завершения.')
    }

    const pending = this.startLaunch(versionId, instanceId)
    this.pendingLaunch = pending

    try {
      await pending
    } finally {
      this.pendingLaunch = null
    }
  }

  private async startLaunch(versionId: string, instanceId?: string): Promise<void> {
    const target = this.resolveTarget(versionId, instanceId)
    const accountId = this.accounts.getActiveAccountId()
    if (!accountId) {
      throw new Error('Сначала добавьте аккаунт.')
    }

    const settings = this.config.get()
    const profile = resolveVersionProfile(
      target.versionId,
      target.versionsDirectory,
      target.fallbackVersionsDirectory ? [target.fallbackVersionsDirectory] : []
    )
    const version = profile.version
    const nativesDirectory = join(
      this.installed.versionDirectory(profile.baseVersionId, instanceId),
      'natives'
    )

    const requiredJava = version.javaVersion?.majorVersion ?? 8
    const java = await this.java.resolve(requiredJava)
    const session = await this.accounts.getSession(accountId)

    const context = createRuleContext()
    const { classpath } = resolveLibraries(
      version,
      context,
      target.librariesDirectories
    )
    const missing = classpath.filter((library) => !existsSync(library.path))
    if (missing.length > 0) {
      throw new Error(
        `Повреждена установка: не хватает ${missing.length} библиотек. Переустановите версию.`
      )
    }

    const assetIndex = version.assetIndex
    if (!assetIndex) {
      throw new Error('У версии нет индекса ресурсов. Переустановите её.')
    }

    const assetIndexPath = join(target.assetsDirectory, 'indexes', `${assetIndex.id}.json`)
    const assetIndexData = readJson<AssetIndexFile>(assetIndexPath)
    if (!assetIndexData) {
      throw new Error('Индекс ресурсов не найден. Переустановите версию.')
    }
    if (assetIndexData.map_to_resources) {
      throw new Error('Версии с map_to_resources пока не поддерживаются.')
    }

    const assetsRoot = assetIndexData.virtual
      ? join(target.assetsDirectory, 'virtual', assetIndex.id)
      : target.assetsDirectory

    ensureDir(nativesDirectory)
    for (const subdirectory of ['java', 'jna', 'lwjgl', 'netty']) {
      ensureDir(join(nativesDirectory, subdirectory))
    }

    const classpathEntries = [...classpath.map((library) => library.path), profile.clientJarPath]
    const classpathValue = classpathEntries.join(delimiter)
    const loggingArgument = this.loggingArgument(version, target.assetsDirectory)

    const replacements: Record<string, string> = {
      auth_player_name: session.username,
      version_name: version.id,
      game_directory: target.gameDirectory,
      assets_root: assetsRoot,
      assets_index_name: assetIndex.id,
      auth_uuid: stripUuidDashes(session.uuid),
      auth_access_token: session.accessToken,
      auth_session: session.accessToken,
      user_type: session.userType,
      version_type: version.type,
      natives_directory: nativesDirectory,
      launcher_name: 'Cerberus',
      launcher_version: app.getVersion(),
      classpath: classpathValue,
      classpath_separator: delimiter,
      library_directory: target.librariesDirectories[0] ?? '',
      auth_xuid: session.xuid ?? '',
      clientid: session.clientId ?? '',
      resolution_width: '1280',
      resolution_height: '720',
      user_properties: '{}',
      game_assets: assetsRoot
    }

    const versionJvmArguments = version.arguments?.jvm
      ? evaluateArguments(version.arguments.jvm, context, replacements)
      : []
    const gameArguments = version.arguments?.game
      ? evaluateArguments(version.arguments.game, context, replacements)
      : evaluateLegacyArguments(version.minecraftArguments, replacements)

    if (gameArguments.length === 0) {
      throw new Error('В описании версии нет игровых аргументов.')
    }

    const memoryArguments = [
      `-Xmx${settings.memoryMb}M`,
      `-Xms${Math.min(1024, settings.memoryMb)}M`
    ]
    const extraArguments = splitArgs(settings.jvmArgs)
    const jvmArguments = [...memoryArguments, ...extraArguments]

    if (loggingArgument) jvmArguments.push(loggingArgument)
    jvmArguments.push(...versionJvmArguments)

    if (!jvmArguments.some((arg) => arg.startsWith('-Djava.library.path='))) {
      jvmArguments.push(`-Djava.library.path=${nativesDirectory}`)
    }
    if (!jvmArguments.includes('-cp') && !jvmArguments.includes('-classpath')) {
      jvmArguments.push('-cp', classpathValue)
    }

    this.warnUnknownPlaceholders([...jvmArguments, ...gameArguments], replacements)

    this.setState({
      status: 'starting',
      versionId: target.versionId,
      instanceId,
      message: target.instanceId ? 'Запускаем инстанс…' : 'Запускаем Minecraft…',
      startedAt: Date.now()
    })
    this.systemLog(
      `Запуск ${version.id} (Java ${java.version})${target.instanceId ? ` · инстанс ${target.instanceId}` : ''}`
    )

    const child = spawn(
      java.path,
      [...jvmArguments, version.mainClass, ...gameArguments],
      {
        cwd: target.gameDirectory,
        env: process.env,
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    this.process = child
    this.startedAt = Date.now()

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    this.pipeOutput(child.stdout, 'stdout')
    this.pipeOutput(child.stderr, 'stderr')

    await new Promise<void>((resolve, reject) => {
      const onSpawn = (): void => {
        cleanup()
        this.setState({
          status: 'running',
          versionId: target.versionId,
          instanceId,
          pid: child.pid,
          startedAt: Date.now()
        })
        this.systemLog(`Игра запущена (PID ${child.pid ?? '—'})`)
        if (target.instanceId) this.instances.touchLaunched(target.instanceId)
        resolve()
      }

      const onError = (error: Error): void => {
        cleanup()
        this.process = null
        const message = `Не удалось запустить Java: ${formatError(error)}`
        this.setState({ status: 'error', versionId: target.versionId, instanceId, message })
        this.systemLog(message)
        reject(new Error(message))
      }

      const cleanup = (): void => {
        child.off('spawn', onSpawn)
        child.off('error', onError)
      }

      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    child.on('close', (code, signal) => {
      if (this.process !== child) return
      this.process = null

      if (target.instanceId) {
        this.instances.addPlaytime(target.instanceId, (Date.now() - this.startedAt) / 1000)
      }

      const message =
        code === 0
          ? 'Игра завершилась.'
          : `Игра завершилась с кодом ${code ?? '—'}${signal ? ` (${signal})` : ''}.`

      this.setState({ status: 'exited', versionId: target.versionId, instanceId, code, signal, message })
      this.systemLog(message)
    })

    child.on('error', (error) => {
      if (this.process !== child) return
      this.process = null
      const message = `Ошибка процесса Minecraft: ${formatError(error)}`
      this.setState({ status: 'error', versionId: target.versionId, instanceId, message })
      this.systemLog(message)
    })
  }

  private resolveTarget(versionId: string, instanceId?: string): LaunchTarget {
    const settings = this.config.get()
    const globalLibraries = this.installed.librariesDirectory()
    const assetsDirectory = this.installed.assetsDirectory()

    if (!instanceId) {
      const installedVersion = this.installed.get(versionId)
      if (!installedVersion) {
        throw new Error(`Версия ${versionId} не установлена.`)
      }
      return {
        versionId,
        gameDirectory: settings.gameDirectory,
        versionsDirectory: this.installed.versionsDirectory(),
        librariesDirectories: [globalLibraries],
        assetsDirectory
      }
    }

    const instance = this.instances.get(instanceId)
    if (!instance) throw new Error('Инстанс не найден.')
    if (versionId !== instance.launchVersionId) {
      throw new Error('Версия запуска не соответствует инстансу.')
    }
    const baseVersion = this.installed.get(instance.minecraftVersion, instanceId)
    if (!baseVersion) {
      throw new Error('Minecraft инстанса не установлен. Пересоздайте инстанс.')
    }

    const instanceLibraries = join(this.instances.minecraftDirectory(instanceId), 'libraries')
    return {
      versionId,
      instanceId,
      gameDirectory: this.instances.minecraftDirectory(instanceId),
      versionsDirectory: this.instances.versionsDirectory(instanceId),
      fallbackVersionsDirectory: this.installed.versionsDirectory(),
      librariesDirectories: [instanceLibraries, globalLibraries],
      assetsDirectory
    }
  }

  stop(): boolean {
    if (!this.process) return false
    if (this.state.status === 'stopping') return true

    this.setState({ ...this.state, status: 'stopping', message: 'Останавливаем игру…' })
    this.systemLog('Отправляем игре сигнал завершения…')

    const pid = this.process.pid
    if (process.platform === 'win32' && pid) {
      // java.exe из Oracle javapath запускает настоящую JVM дочерним процессом,
      // поэтому останавливать нужно всё дерево, иначе игра продолжит работать.
      const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.on('error', () => {
        try {
          this.process?.kill()
        } catch (error) {
          this.setState({ ...this.state, status: 'error', message: formatError(error) })
        }
      })
      killer.on('close', (code) => {
        if (code === 0) return
        try {
          this.process?.kill()
        } catch {
          // Процесс уже завершился.
        }
      })
      return true
    }

    try {
      this.process.kill()
      return true
    } catch (error) {
      this.setState({ ...this.state, status: 'error', message: formatError(error) })
      return false
    }
  }

  private loggingArgument(version: VersionJson, assetsDirectory: string): string | null {
    const logging = version.logging?.client
    if (!logging) return null

    const path = join(assetsDirectory, 'log_configs', logging.file.id)
    if (!existsSync(path)) {
      log.warn('launcher', `Не найден log4j-конфиг ${path}, пропускаем аргумент`)
      return null
    }
    return logging.argument.replace('${path}', path)
  }

  private pipeOutput(
    stream: NodeJS.ReadableStream,
    kind: 'stdout' | 'stderr'
  ): void {
    const reader = createInterface({ input: stream, crlfDelay: Infinity })
    reader.on('line', (line) => {
      const clean = stripAnsi(line).replace(/\r$/, '')
      this.emitLog({
        stream: kind,
        line: clean,
        timestamp: Date.now()
      })
    })
  }

  private warnUnknownPlaceholders(argumentsList: string[], replacements: Record<string, string>): void {
    const unknown = new Set<string>()
    for (const argument of argumentsList) {
      for (const match of argument.matchAll(/\$\{([^}]+)\}/g)) {
        if (!(match[1] in replacements)) unknown.add(match[1])
      }
    }
    for (const key of unknown) {
      log.warn('launcher', `Неизвестный placeholder аргументов: \${${key}}`)
    }
  }

  private setState(state: LaunchState): void {
    this.state = state
    this.emitState({ ...state })
  }

  private systemLog(line: string): void {
    this.emitLog({ stream: 'system', line, timestamp: Date.now() })
  }
}
