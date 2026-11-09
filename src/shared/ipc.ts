import type { IpcResult } from './result'
import type {
  Account,
  AccountsUpdateResult,
  AddOfflineAccountResult,
  BootstrapData,
  CatalogProject,
  CatalogSearchRequest,
  CatalogSearchResult,
  CatalogSource,
  CatalogVersion,
  ContentInstallResult,
  ContentType,
  CreateInstanceRequest,
  Instance,
  InstanceContent,
  InstalledVersion,
  InstallContentRequest,
  InstallModpackRequest,
  InstallProgress,
  JavaInfo,
  LaunchLog,
  LaunchState,
  LoaderType,
  LoaderVersionInfo,
  MicrosoftDeviceCode,
  MicrosoftFlowError,
  MicrosoftFlowStatus,
  MicrosoftFlowSuccess,
  RemoteVersion,
  Settings,
  SettingsUpdateResult,
  TaskResult
} from './types'

export const IPC = {
  bootstrap: 'app:bootstrap',

  listRemoteVersions: 'versions:list-remote',
  listInstalledVersions: 'versions:list-installed',
  installVersion: 'versions:install',
  cancelInstall: 'versions:cancel-install',
  deleteVersion: 'versions:delete',
  launchVersion: 'versions:launch',
  stopGame: 'versions:stop',
  getLaunchState: 'versions:launch-state',

  listInstances: 'instances:list',
  getInstance: 'instances:get',
  createInstance: 'instances:create',
  deleteInstance: 'instances:delete',
  launchInstance: 'instances:launch',
  openInstancePath: 'instances:open-path',
  listLoaderVersions: 'instances:loader-versions',
  listInstanceContent: 'instances:content-list',
  removeInstanceContent: 'instances:content-remove',

  searchCatalog: 'catalog:search',
  featuredModpacks: 'catalog:featured-modpacks',
  listCatalogVersions: 'catalog:versions',
  installModpack: 'catalog:install-modpack',
  installContent: 'catalog:install-content',
  checkCurseForge: 'catalog:check-curseforge',

  addOfflineAccount: 'accounts:add-offline',
  removeAccount: 'accounts:remove',
  setActiveAccount: 'accounts:set-active',
  startMicrosoftLogin: 'accounts:microsoft-start',
  cancelMicrosoftLogin: 'accounts:microsoft-cancel',

  updateSettings: 'settings:update',
  detectJava: 'java:detect',

  pickPath: 'dialog:pick-path',
  openPath: 'shell:open-path',
  openExternal: 'shell:open-external',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized'
} as const

export const IPC_EVENTS = {
  installProgress: 'versions:install-progress',
  installDone: 'versions:install-done',
  launchLog: 'versions:launch-log',
  launchState: 'versions:launch-state',
  authStatus: 'auth:flow-status',
  authSuccess: 'auth:flow-success',
  authError: 'auth:flow-error',
  windowMaximized: 'window:maximized'
} as const

export type PathKind = 'game' | 'data' | 'logs'
export type PickPathKind = 'game' | 'java'
export type InstancePathTarget =
  | 'root'
  | 'minecraft'
  | 'mods'
  | 'resourcepacks'
  | 'shaderpacks'
  | 'saves'
  | 'versions'

export interface CerberusApi {
  bootstrap(): Promise<IpcResult<BootstrapData>>

  listRemoteVersions(force?: boolean): Promise<IpcResult<RemoteVersion[]>>
  listInstalledVersions(): Promise<IpcResult<InstalledVersion[]>>
  installVersion(versionId: string): Promise<IpcResult<TaskResult>>
  cancelInstall(taskId: string): Promise<IpcResult<boolean>>
  deleteVersion(versionId: string): Promise<IpcResult<InstalledVersion[]>>
  launchVersion(versionId: string): Promise<IpcResult<null>>
  stopGame(): Promise<IpcResult<boolean>>
  getLaunchState(): Promise<IpcResult<LaunchState>>

  listInstances(): Promise<IpcResult<Instance[]>>
  getInstance(instanceId: string): Promise<IpcResult<Instance>>
  createInstance(request: CreateInstanceRequest): Promise<IpcResult<TaskResult>>
  deleteInstance(instanceId: string): Promise<IpcResult<Instance[]>>
  launchInstance(instanceId: string): Promise<IpcResult<null>>
  openInstancePath(instanceId: string, target?: InstancePathTarget): Promise<IpcResult<null>>
  listLoaderVersions(
    loader: LoaderType,
    minecraftVersion: string
  ): Promise<IpcResult<LoaderVersionInfo[]>>
  listInstanceContent(instanceId: string): Promise<IpcResult<InstanceContent[]>>
  removeInstanceContent(instanceId: string, contentId: string): Promise<IpcResult<InstanceContent[]>>

  searchCatalog(request: CatalogSearchRequest): Promise<IpcResult<CatalogSearchResult>>
  featuredModpacks(): Promise<IpcResult<CatalogProject[]>>
  listCatalogVersions(
    source: CatalogSource,
    projectId: string,
    type: ContentType,
    gameVersion?: string,
    loader?: LoaderType
  ): Promise<IpcResult<CatalogVersion[]>>
  installModpack(request: InstallModpackRequest): Promise<IpcResult<TaskResult>>
  installContent(request: InstallContentRequest): Promise<IpcResult<ContentInstallResult>>
  checkCurseForge(apiKey: string): Promise<IpcResult<boolean>>

  addOfflineAccount(username: string): Promise<IpcResult<AddOfflineAccountResult>>
  removeAccount(accountId: string): Promise<IpcResult<AccountsUpdateResult>>
  setActiveAccount(accountId: string): Promise<IpcResult<AccountsUpdateResult>>
  startMicrosoftLogin(): Promise<IpcResult<MicrosoftDeviceCode>>
  cancelMicrosoftLogin(flowId: string): Promise<IpcResult<boolean>>

  updateSettings(patch: Partial<Settings>): Promise<IpcResult<SettingsUpdateResult>>
  detectJava(): Promise<IpcResult<JavaInfo[]>>

  pickPath(kind: PickPathKind): Promise<IpcResult<string | null>>
  openPath(kind: PathKind): Promise<IpcResult<null>>
  openExternal(url: string): Promise<IpcResult<null>>

  windowMinimize(): void
  windowToggleMaximize(): void
  windowClose(): void
  windowIsMaximized(): Promise<boolean>

  onInstallProgress(callback: (progress: InstallProgress) => void): () => void
  onInstallDone(callback: (result: TaskResult) => void): () => void
  onLaunchLog(callback: (line: LaunchLog) => void): () => void
  onLaunchState(callback: (state: LaunchState) => void): () => void
  onAuthStatus(callback: (status: MicrosoftFlowStatus) => void): () => void
  onAuthSuccess(callback: (result: MicrosoftFlowSuccess) => void): () => void
  onAuthError(callback: (error: MicrosoftFlowError) => void): () => void
  onWindowMaximized(callback: (maximized: boolean) => void): () => void
}

export type { Account }
