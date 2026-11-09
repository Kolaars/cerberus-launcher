export type AccountType = 'microsoft' | 'offline'

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha' | string

export type UiMode = 'classic' | 'prism'

export type InstanceSource = 'manual' | 'modrinth' | 'curseforge'

export type ContentType = 'modpack' | 'mod' | 'shader' | 'resourcepack'

export type CatalogSource = 'modrinth' | 'curseforge'

export interface Account {
  id: string
  type: AccountType
  username: string
  /** UUID с дефисами. Для Minecraft UUID без дефисов формируется при запуске. */
  uuid: string
  skinUrl?: string
  skinVariant?: 'classic' | 'slim' | string
  createdAt: number
}

export interface Settings {
  gameDirectory: string
  javaPath: string | null
  memoryMb: number
  showSnapshots: boolean
  microsoftClientId: string
  jvmArgs: string
  uiMode: UiMode
  curseForgeApiKey: string
}

export interface InstalledVersion {
  id: string
  type: VersionType
  releaseTime: string
  installedAt: number
  loader: LoaderType
}

export interface RemoteVersion {
  id: string
  type: VersionType
  releaseTime: string
  url: string
}

export interface JavaInfo {
  path: string
  version: string
  major: number
}

export interface AppVersions {
  app: string
  electron: string
  chrome: string
  node: string
}

export interface Instance {
  id: string
  name: string
  description: string
  iconUrl?: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion: string | null
  /** Версия, которую нужно передать лаунчеру (Minecraft или профиль загрузчика). */
  launchVersionId: string
  source: InstanceSource
  projectId?: string
  projectVersionId?: string
  projectVersionName?: string
  createdAt: number
  lastPlayedAt: number | null
  playtimeSeconds: number
  contentCount: number
}

export interface InstanceContent {
  id: string
  source: CatalogSource
  projectId: string
  projectType: Exclude<ContentType, 'modpack'>
  name: string
  versionId: string
  versionNumber: string
  fileName: string
  /** Путь относительно minecraft-папки инстанса. */
  relativePath: string
  iconUrl?: string
  installedAt: number
}

export interface CreateInstanceRequest {
  name: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion?: string | null
  description?: string
  iconUrl?: string
  source?: InstanceSource
  projectId?: string
  projectVersionId?: string
}

export interface LoaderVersionInfo {
  version: string
  stable: boolean
}

export interface CatalogSearchRequest {
  source: CatalogSource
  type: ContentType
  query?: string
  gameVersion?: string
  loader?: LoaderType
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'updated' | 'newest'
}

export interface CatalogProject {
  id: string
  source: CatalogSource
  projectId: string
  projectType: ContentType
  slug: string
  name: string
  description: string
  author: string
  iconUrl?: string
  gallery: string[]
  downloads: number
  follows: number
  categories: string[]
  gameVersions: string[]
  loaders: string[]
  dateModified: string
  latestVersionId?: string
}

export interface CatalogSearchResult {
  projects: CatalogProject[]
  total: number
  offset: number
  limit: number
}

export interface CatalogVersion {
  id: string
  projectId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  downloads: number
  publishedAt: string
  fileName: string
  fileSize: number
  downloadUrl: string
  sha1?: string
}

export interface InstallModpackRequest {
  source: CatalogSource
  projectId: string
  versionId: string
  projectVersionName?: string
}

export interface InstallContentRequest {
  source: CatalogSource
  projectId: string
  versionId: string
  instanceId: string
  projectType: Exclude<ContentType, 'modpack'>
  versionNumber?: string
  name?: string
  iconUrl?: string
}

export interface ContentInstallResult {
  content: InstanceContent
  instance: Instance
}

export interface BootstrapData {
  settings: Settings
  accounts: Account[]
  activeAccountId: string | null
  installedVersions: InstalledVersion[]
  instances: Instance[]
  java: JavaInfo | null
  versions: AppVersions
  dataDirectory: string
  logsDirectory: string
  defaultGameDirectory: string
}

export type InstallKind = 'version' | 'instance' | 'modpack' | 'loader' | 'content'

export type InstallStage =
  | 'preparing'
  | 'version'
  | 'client'
  | 'libraries'
  | 'assets'
  | 'natives'
  | 'loader'
  | 'content'
  | 'finishing'

export interface InstallProgress {
  taskId: string
  versionId: string
  stage: InstallStage
  message: string
  current: number
  total: number
  percent: number
  instanceId?: string
  kind?: InstallKind
  label?: string
}

export interface TaskResult {
  taskId: string
  versionId: string
  ok: boolean
  cancelled?: boolean
  error?: string
  instanceId?: string
  kind?: InstallKind
}

export type LaunchStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'exited' | 'error'

export interface LaunchState {
  status: LaunchStatus
  versionId?: string
  instanceId?: string
  pid?: number
  code?: number | null
  signal?: string | null
  message?: string
  startedAt?: number
}

export interface LaunchLog {
  stream: 'stdout' | 'stderr' | 'system'
  line: string
  timestamp: number
}

export type MicrosoftFlowPhase = 'waiting' | 'authorizing' | 'finishing'

export interface MicrosoftDeviceCode {
  flowId: string
  userCode: string
  verificationUri: string
  expiresAt: number
  message: string
}

export interface MicrosoftFlowStatus {
  flowId: string
  phase: MicrosoftFlowPhase
  message?: string
}

export interface MicrosoftFlowError {
  flowId: string
  error: string
  code?: string
}

export interface MicrosoftFlowSuccess {
  flowId: string
  account: Account
  accounts: Account[]
  activeAccountId: string
}

export interface SettingsUpdateResult {
  settings: Settings
  installedVersions: InstalledVersion[]
  instances: Instance[]
}

export interface AccountsUpdateResult {
  accounts: Account[]
  activeAccountId: string | null
}

export interface AddOfflineAccountResult extends AccountsUpdateResult {
  account: Account
}
