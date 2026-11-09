import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import {
  IPC,
  type InstancePathTarget,
  type PathKind,
  type PickPathKind
} from '@shared/ipc'
import { ipcFail, ipcOk, type IpcResult } from '@shared/result'
import type {
  BootstrapData,
  CatalogSearchRequest,
  CatalogSource,
  ContentType,
  CreateInstanceRequest,
  InstallContentRequest,
  InstallModpackRequest,
  JavaInfo,
  LaunchState,
  LoaderType,
  RemoteVersion,
  Settings
} from '@shared/types'
import { ensureDir } from './utils/fs'
import type { AccountStore } from './services/account-store'
import type { CatalogService } from './services/catalog'
import type { ConfigStore } from './services/config-store'
import type { InstanceService } from './services/instances'
import type { JavaService } from './services/java'
import type { ModLoaderRegistry } from './services/modloader'
import type { ContentService } from './services/modpack'
import type { AppPaths } from './services/paths'
import type { InstalledService } from './services/minecraft/installed'
import type { InstallerService } from './services/minecraft/installer'
import type { GameLauncher } from './services/minecraft/launcher'
import type { VersionManifestService } from './services/minecraft/version-manifest'
import { openExternalUrl } from './window'

export interface IpcContext {
  paths: AppPaths
  config: ConfigStore
  accounts: AccountStore
  java: JavaService
  manifest: VersionManifestService
  installed: InstalledService
  instances: InstanceService
  installer: InstallerService
  loaders: ModLoaderRegistry
  catalog: CatalogService
  content: ContentService
  launcher: GameLauncher
}

const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']
const CONTENT_TYPES: ContentType[] = ['modpack', 'mod', 'shader', 'resourcepack']
const CATALOG_SOURCES: CatalogSource[] = ['modrinth', 'curseforge']
const INSTANCE_TARGETS: InstancePathTarget[] = [
  'root',
  'minecraft',
  'mods',
  'resourcepacks',
  'shaderpacks',
  'saves',
  'versions'
]

export function registerIpc(context: IpcContext, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.bootstrap, () =>
    run(async () => {
      const settings = context.config.get()
      const javaList = await context.java.detect()
      const configuredJava = settings.javaPath
      const java =
        javaList.find(
          (item) => item.path.toLowerCase() === configuredJava?.toLowerCase()
        ) ??
        javaList[0] ??
        null

      const data: BootstrapData = {
        settings,
        accounts: context.accounts.list(),
        activeAccountId: context.accounts.getActiveAccountId(),
        installedVersions: context.installed.list(),
        instances: context.instances.list(),
        java,
        versions: {
          app: app.getVersion(),
          electron: process.versions.electron ?? '',
          chrome: process.versions.chrome ?? '',
          node: process.versions.node ?? ''
        },
        dataDirectory: context.paths.dataDirectory,
        logsDirectory: context.paths.logsDirectory,
        defaultGameDirectory: context.paths.defaultGameDirectory
      }
      return data
    })
  )

  ipcMain.handle(IPC.listRemoteVersions, (_event, force: boolean) =>
    run<RemoteVersion[]>(async () => {
      const manifest = await context.manifest.getManifest(Boolean(force))
      const showSnapshots = context.config.get().showSnapshots

      return manifest.versions
        .filter(
          (version) =>
            version.type === 'release' || (showSnapshots && version.type === 'snapshot')
        )
        .map((version) => ({
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime,
          url: version.url
        }))
    })
  )

  ipcMain.handle(IPC.listInstalledVersions, () => run(() => context.installed.list()))

  ipcMain.handle(IPC.installVersion, (_event, versionId: string) =>
    run(async () => {
      assertVersionId(versionId)
      if (isLaunchActive(context.launcher.getState())) {
        throw new Error('Нельзя устанавливать версии во время запуска игры.')
      }
      return context.installer.install(versionId)
    })
  )

  ipcMain.handle(IPC.cancelInstall, (_event, taskId: string) =>
    run(() => {
      assertId(taskId, 'задачи')
      return context.installer.cancel(taskId)
    })
  )

  ipcMain.handle(IPC.deleteVersion, (_event, versionId: string) =>
    run(() => {
      assertVersionId(versionId)
      if (isLaunchActive(context.launcher.getState())) {
        throw new Error('Нельзя удалять версии во время запуска игры.')
      }
      if (context.installer.isInstalling()) {
        throw new Error('Дождитесь завершения установки перед удалением версии.')
      }
      context.installed.remove(versionId)
      return context.installed.list()
    })
  )

  ipcMain.handle(IPC.launchVersion, (_event, versionId: string) =>
    run(async () => {
      assertVersionId(versionId)
      if (context.installer.isInstalling()) {
        throw new Error('Дождитесь завершения установки перед запуском игры.')
      }
      await context.launcher.launch(versionId)
      return null
    })
  )

  ipcMain.handle(IPC.stopGame, () => run(() => context.launcher.stop()))
  ipcMain.handle(IPC.getLaunchState, () => run(() => context.launcher.getState()))

  ipcMain.handle(IPC.listInstances, () => run(() => context.instances.list()))

  ipcMain.handle(IPC.getInstance, (_event, instanceId: string) =>
    run(() => {
      assertId(instanceId, 'инстанса')
      const instance = context.instances.get(instanceId)
      if (!instance) throw new Error('Инстанс не найден.')
      return instance
    })
  )

  ipcMain.handle(IPC.createInstance, (_event, request: CreateInstanceRequest) =>
    run(async () => {
      assertCanStartOperation(context)
      return context.content.createInstance(normalizeCreateInstance(request))
    })
  )

  ipcMain.handle(IPC.deleteInstance, (_event, instanceId: string) =>
    run(() => {
      assertId(instanceId, 'инстанса')
      const launch = context.launcher.getState()
      if (isLaunchActive(launch) && launch.instanceId === instanceId) {
        throw new Error('Нельзя удалить инстанс, пока игра из него запущена.')
      }
      if (context.installer.isInstalling()) {
        throw new Error('Дождитесь завершения установки перед удалением инстанса.')
      }
      if (!context.instances.get(instanceId)) {
        throw new Error('Инстанс не найден.')
      }
      context.instances.remove(instanceId)
      return context.instances.list()
    })
  )

  ipcMain.handle(IPC.launchInstance, (_event, instanceId: string) =>
    run(async () => {
      assertId(instanceId, 'инстанса')
      if (context.installer.isInstalling()) {
        throw new Error('Дождитесь завершения установки перед запуском игры.')
      }
      const instance = context.instances.get(instanceId)
      if (!instance) throw new Error('Инстанс не найден.')
      await context.launcher.launch(instance.launchVersionId, instance.id)
      return null
    })
  )

  ipcMain.handle(
    IPC.openInstancePath,
    (_event, instanceId: string, target: InstancePathTarget = 'root') =>
      run(async () => {
        assertId(instanceId, 'инстанса')
        if (!INSTANCE_TARGETS.includes(target)) {
          throw new Error('Неизвестный тип папки инстанса.')
        }
        const instance = context.instances.get(instanceId)
        if (!instance) throw new Error('Инстанс не найден.')

        const targetPath = resolveInstancePath(context, instanceId, target)
        ensureDir(targetPath)
        const error = await shell.openPath(targetPath)
        if (error) throw new Error(error)
        return null
      })
  )

  ipcMain.handle(
    IPC.listLoaderVersions,
    (_event, loader: LoaderType, minecraftVersion: string) =>
      run(async () => {
        assertLoader(loader)
        assertVersionId(minecraftVersion)
        if (loader === 'vanilla') return []
        return context.loaders.listVersions(loader, minecraftVersion)
      })
  )

  ipcMain.handle(IPC.listInstanceContent, (_event, instanceId: string) =>
    run(() => {
      assertId(instanceId, 'инстанса')
      if (!context.instances.get(instanceId)) throw new Error('Инстанс не найден.')
      return context.instances.listContent(instanceId)
    })
  )

  ipcMain.handle(
    IPC.removeInstanceContent,
    (_event, instanceId: string, contentId: string) =>
      run(async () => {
        assertId(instanceId, 'инстанса')
        assertId(contentId, 'контента')
        if (isLaunchActive(context.launcher.getState())) {
          throw new Error('Нельзя изменять контент во время запуска игры.')
        }
        return context.content.removeContent(instanceId, contentId)
      })
  )

  ipcMain.handle(IPC.searchCatalog, (_event, request: CatalogSearchRequest) =>
    run(() => context.catalog.search(normalizeSearchRequest(request)))
  )

  ipcMain.handle(IPC.featuredModpacks, () => run(() => context.catalog.featuredModpacks()))

  ipcMain.handle(
    IPC.listCatalogVersions,
    (
      _event,
      source: CatalogSource,
      projectId: string,
      type: ContentType,
      gameVersion?: string,
      loader?: LoaderType
    ) =>
      run(() => {
        assertCatalogSource(source)
        assertCatalogId(projectId, 'проекта')
        assertContentType(type)
        if (gameVersion !== undefined) assertVersionId(gameVersion)
        if (loader !== undefined) assertLoader(loader)
        return context.catalog.listVersions(source, projectId, type, gameVersion, loader)
      })
  )

  ipcMain.handle(IPC.installModpack, (_event, request: InstallModpackRequest) =>
    run(async () => {
      assertCanStartOperation(context)
      return context.content.installModpack(normalizeInstallModpack(request))
    })
  )

  ipcMain.handle(IPC.installContent, (_event, request: InstallContentRequest) =>
    run(async () => {
      assertCanStartOperation(context)
      return context.content.installContent(normalizeInstallContent(request))
    })
  )

  ipcMain.handle(IPC.checkCurseForge, (_event, apiKey: string) =>
    run(() => {
      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        throw new Error('Укажите API-ключ CurseForge.')
      }
      return context.catalog.checkCurseForge(apiKey.trim())
    })
  )

  ipcMain.handle(IPC.addOfflineAccount, (_event, username: string) =>
    run(() => {
      if (typeof username !== 'string') throw new Error('Некорректное имя игрока.')
      return context.accounts.addOfflineAccount(username)
    })
  )

  ipcMain.handle(IPC.removeAccount, (_event, accountId: string) =>
    run(() => {
      assertId(accountId, 'аккаунта')
      return context.accounts.removeAccount(accountId)
    })
  )

  ipcMain.handle(IPC.setActiveAccount, (_event, accountId: string) =>
    run(() => {
      assertId(accountId, 'аккаунта')
      return context.accounts.setActiveAccount(accountId)
    })
  )

  ipcMain.handle(IPC.startMicrosoftLogin, () => run(() => context.accounts.startMicrosoftLogin()))
  ipcMain.handle(IPC.cancelMicrosoftLogin, (_event, flowId: string) =>
    run(() => {
      assertId(flowId, 'потока входа')
      return context.accounts.cancelMicrosoftLogin(flowId)
    })
  )

  ipcMain.handle(IPC.updateSettings, (_event, patch: Partial<Settings>) =>
    run(async () => {
      if (!patch || typeof patch !== 'object') throw new Error('Некорректные настройки.')
      const settings = context.config.update(patch)
      return {
        settings,
        installedVersions: context.installed.list(),
        instances: context.instances.list()
      }
    })
  )

  ipcMain.handle(IPC.detectJava, () => run<JavaInfo[]>(() => context.java.detect()))

  ipcMain.handle(IPC.pickPath, (_event, kind: PickPathKind) =>
    run(async () => {
      const window = getWindow()
      if (!window) throw new Error('Окно приложения недоступно.')

      if (kind === 'game') {
        const result = await dialog.showOpenDialog(window, {
          title: 'Выберите папку для файлов игры',
          properties: ['openDirectory', 'createDirectory']
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }

      if (kind === 'java') {
        const result = await dialog.showOpenDialog(window, {
          title: 'Выберите исполняемый файл Java',
          properties: ['openFile'],
          filters:
            process.platform === 'win32'
              ? [{ name: 'Java', extensions: ['exe'] }]
              : [{ name: 'Все файлы', extensions: ['*'] }]
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }

      throw new Error('Неизвестный тип пути.')
    })
  )

  ipcMain.handle(IPC.openPath, (_event, kind: PathKind) =>
    run(async () => {
      const settings = context.config.get()
      let target: string

      if (kind === 'game') {
        target = settings.gameDirectory
        ensureDir(target)
      } else if (kind === 'data') {
        target = context.paths.dataDirectory
      } else if (kind === 'logs') {
        target = context.paths.logsDirectory
      } else {
        throw new Error('Неизвестный тип пути.')
      }

      const error = await shell.openPath(target)
      if (error) throw new Error(error)
      return null
    })
  )

  ipcMain.handle(IPC.openExternal, (_event, url: string) =>
    run(async () => {
      if (typeof url !== 'string') throw new Error('Некорректная ссылка.')
      await openExternalUrl(url)
      return null
    })
  )

  ipcMain.on(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.on(IPC.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.on(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
}

async function run<T>(operation: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return ipcOk(await operation())
  } catch (error) {
    return ipcFail(error)
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Некорректный идентификатор ${label}.`)
  }
}

function assertVersionId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9._+-]{1,64}$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error('Некорректный идентификатор версии Minecraft.')
  }
}

function assertCatalogId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new Error(`Некорректный идентификатор ${label}.`)
  }
}

function assertLoader(value: unknown): asserts value is LoaderType {
  if (typeof value !== 'string' || !LOADERS.includes(value as LoaderType)) {
    throw new Error('Неизвестный тип загрузчика.')
  }
}

function assertCatalogSource(value: unknown): asserts value is CatalogSource {
  if (typeof value !== 'string' || !CATALOG_SOURCES.includes(value as CatalogSource)) {
    throw new Error('Неизвестный источник каталога.')
  }
}

function assertContentType(value: unknown): asserts value is ContentType {
  if (typeof value !== 'string' || !CONTENT_TYPES.includes(value as ContentType)) {
    throw new Error('Неизвестный тип контента.')
  }
}

function assertCanStartOperation(context: IpcContext): void {
  if (isLaunchActive(context.launcher.getState())) {
    throw new Error('Нельзя устанавливать контент во время запуска игры.')
  }
  if (context.installer.isInstalling()) {
    throw new Error('Дождитесь завершения текущей установки.')
  }
}

function normalizeSearchRequest(value: CatalogSearchRequest): CatalogSearchRequest {
  if (!value || typeof value !== 'object') throw new Error('Некорректный запрос каталога.')
  assertCatalogSource(value.source)
  assertContentType(value.type)
  if (value.loader !== undefined) assertLoader(value.loader)
  if (value.gameVersion !== undefined && value.gameVersion !== '') {
    assertVersionId(value.gameVersion)
  }

  const sort = value.sort
  if (
    sort !== undefined &&
    !['relevance', 'downloads', 'updated', 'newest'].includes(sort)
  ) {
    throw new Error('Неизвестный порядок сортировки.')
  }

  return {
    source: value.source,
    type: value.type,
    query: typeof value.query === 'string' ? value.query.slice(0, 120) : '',
    gameVersion: value.gameVersion || undefined,
    loader: value.loader,
    offset: Math.max(0, Math.min(10_000, Math.round(Number(value.offset) || 0))),
    limit: Math.max(1, Math.min(50, Math.round(Number(value.limit) || 20))),
    sort
  }
}

function normalizeCreateInstance(value: CreateInstanceRequest): CreateInstanceRequest {
  if (!value || typeof value !== 'object') throw new Error('Некорректные данные инстанса.')
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Укажите название инстанса.')
  }
  assertVersionId(value.minecraftVersion)
  assertLoader(value.loader)

  let loaderVersion: string | null | undefined
  if (value.loaderVersion !== undefined && value.loaderVersion !== null) {
    if (typeof value.loaderVersion !== 'string' || value.loaderVersion.trim().length === 0) {
      throw new Error('Некорректная версия загрузчика.')
    }
    if (!/^[A-Za-z0-9._+-]{1,64}$/.test(value.loaderVersion.trim())) {
      throw new Error('Некорректная версия загрузчика.')
    }
    loaderVersion = value.loaderVersion.trim()
  }

  if (value.source !== undefined) assertCatalogSource(value.source)
  if (value.projectId !== undefined) assertCatalogId(value.projectId, 'проекта')
  if (value.projectVersionId !== undefined) assertCatalogId(value.projectVersionId, 'версии')

  return {
    name: value.name.trim().slice(0, 64),
    minecraftVersion: value.minecraftVersion,
    loader: value.loader,
    loaderVersion,
    description:
      typeof value.description === 'string' ? value.description.slice(0, 500) : undefined,
    iconUrl: typeof value.iconUrl === 'string' ? value.iconUrl.slice(0, 500) : undefined,
    source: value.source,
    projectId: value.projectId,
    projectVersionId: value.projectVersionId
  }
}

function normalizeInstallModpack(value: InstallModpackRequest): InstallModpackRequest {
  if (!value || typeof value !== 'object') throw new Error('Некорректные данные сборки.')
  assertCatalogSource(value.source)
  assertCatalogId(value.projectId, 'проекта')
  assertCatalogId(value.versionId, 'версии')
  return {
    source: value.source,
    projectId: value.projectId,
    versionId: value.versionId,
    projectVersionName:
      typeof value.projectVersionName === 'string'
        ? value.projectVersionName.slice(0, 160)
        : undefined
  }
}

function normalizeInstallContent(value: InstallContentRequest): InstallContentRequest {
  if (!value || typeof value !== 'object') throw new Error('Некорректные данные контента.')
  assertCatalogSource(value.source)
  assertCatalogId(value.projectId, 'проекта')
  assertCatalogId(value.versionId, 'версии')
  assertId(value.instanceId, 'инстанса')
  assertContentType(value.projectType)
  return {
    source: value.source,
    projectId: value.projectId,
    versionId: value.versionId,
    instanceId: value.instanceId,
    projectType: value.projectType,
    versionNumber:
      typeof value.versionNumber === 'string' ? value.versionNumber.slice(0, 160) : undefined,
    name: typeof value.name === 'string' ? value.name.slice(0, 160) : undefined,
    iconUrl: typeof value.iconUrl === 'string' ? value.iconUrl.slice(0, 500) : undefined
  }
}

function resolveInstancePath(
  context: IpcContext,
  instanceId: string,
  target: InstancePathTarget
): string {
  switch (target) {
    case 'root':
      return context.instances.instanceDirectory(instanceId)
    case 'minecraft':
      return context.instances.minecraftDirectory(instanceId)
    case 'mods':
      return context.instances.modsDirectory(instanceId)
    case 'resourcepacks':
      return context.instances.resourcePacksDirectory(instanceId)
    case 'shaderpacks':
      return context.instances.shaderPacksDirectory(instanceId)
    case 'saves':
      return context.instances.savesDirectory(instanceId)
    case 'versions':
      return context.instances.versionsDirectory(instanceId)
    default:
      throw new Error('Неизвестный тип папки инстанса.')
  }
}

function isLaunchActive(state: LaunchState): boolean {
  return state.status === 'starting' || state.status === 'running' || state.status === 'stopping'
}
