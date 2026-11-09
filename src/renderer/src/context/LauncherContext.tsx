import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { InstancePathTarget, PathKind, PickPathKind } from '@shared/ipc'
import type {
  Account,
  AppVersions,
  CatalogProject,
  CatalogSearchRequest,
  CatalogSearchResult,
  CatalogSource,
  CatalogVersion,
  ContentInstallResult,
  ContentType,
  CreateInstanceRequest,
  InstalledVersion,
  Instance,
  InstanceContent,
  InstallContentRequest,
  InstallModpackRequest,
  InstallProgress,
  JavaInfo,
  LaunchLog,
  LaunchState,
  LoaderType,
  LoaderVersionInfo,
  MicrosoftDeviceCode,
  MicrosoftFlowPhase,
  RemoteVersion,
  Settings,
  TaskResult
} from '@shared/types'
import { messageOf, unwrap } from '../lib/ipc'
import { useToast } from './ToastContext'

interface MicrosoftState {
  device: MicrosoftDeviceCode | null
  phase: MicrosoftFlowPhase | null
  message: string | null
  error: string | null
}

interface PathsState {
  dataDirectory: string
  logsDirectory: string
  defaultGameDirectory: string
}

interface LauncherContextValue {
  ready: boolean
  fatalError: string | null
  settings: Settings
  accounts: Account[]
  activeAccountId: string | null
  activeAccount: Account | null
  installed: InstalledVersion[]
  instances: Instance[]
  remote: RemoteVersion[]
  remoteLoading: boolean
  remoteError: string | null
  java: JavaInfo | null
  appVersions: AppVersions
  paths: PathsState
  install: InstallProgress | null
  launch: LaunchState
  logs: LaunchLog[]
  microsoft: MicrosoftState

  refreshRemoteVersions: (force?: boolean) => Promise<void>
  refreshInstalled: () => Promise<void>
  refreshInstances: () => Promise<void>
  installVersion: (versionId: string) => Promise<boolean>
  cancelInstall: () => Promise<void>
  launchVersion: (versionId: string) => Promise<boolean>
  launchInstance: (instanceId: string) => Promise<boolean>
  stopGame: () => Promise<void>
  deleteVersion: (versionId: string) => Promise<boolean>
  createInstance: (request: CreateInstanceRequest) => Promise<TaskResult | null>
  deleteInstance: (instanceId: string) => Promise<boolean>
  openInstancePath: (instanceId: string, target?: InstancePathTarget) => Promise<void>
  listLoaderVersions: (
    loader: LoaderType,
    minecraftVersion: string
  ) => Promise<LoaderVersionInfo[]>
  listInstanceContent: (instanceId: string) => Promise<InstanceContent[]>
  removeInstanceContent: (instanceId: string, contentId: string) => Promise<boolean>

  searchCatalog: (request: CatalogSearchRequest) => Promise<CatalogSearchResult>
  featuredModpacks: () => Promise<CatalogProject[]>
  listCatalogVersions: (
    source: CatalogSource,
    projectId: string,
    type: ContentType,
    gameVersion?: string,
    loader?: LoaderType
  ) => Promise<CatalogVersion[]>
  installModpack: (request: InstallModpackRequest) => Promise<TaskResult | null>
  installContent: (request: InstallContentRequest) => Promise<ContentInstallResult | null>
  checkCurseForge: (apiKey: string) => Promise<boolean>

  addOfflineAccount: (username: string) => Promise<boolean>
  removeAccount: (accountId: string) => Promise<boolean>
  setActiveAccount: (accountId: string) => Promise<void>
  startMicrosoftLogin: () => Promise<void>
  cancelMicrosoftLogin: () => Promise<void>
  dismissMicrosoftError: () => void

  saveSettings: (patch: Partial<Settings>) => Promise<boolean>
  detectJava: () => Promise<JavaInfo[]>
  pickPath: (kind: PickPathKind) => Promise<string | null>
  openPath: (kind: PathKind) => Promise<void>
  openExternal: (url: string) => Promise<void>
  clearLogs: () => void
  retryBootstrap: () => Promise<void>
}

const EMPTY_SETTINGS: Settings = {
  gameDirectory: '',
  javaPath: null,
  memoryMb: 4096,
  showSnapshots: false,
  microsoftClientId: '',
  jvmArgs: '',
  uiMode: 'classic',
  curseForgeApiKey: ''
}

const EMPTY_VERSIONS: AppVersions = { app: '', electron: '', chrome: '', node: '' }
const EMPTY_PATHS: PathsState = {
  dataDirectory: '',
  logsDirectory: '',
  defaultGameDirectory: ''
}
const EMPTY_MICROSOFT: MicrosoftState = {
  device: null,
  phase: null,
  message: null,
  error: null
}

const LauncherContext = createContext<LauncherContextValue | null>(null)

export function LauncherProvider({ children }: { children: ReactNode }) {
  const toast = useToast()

  const [ready, setReady] = useState(false)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null)
  const [installed, setInstalled] = useState<InstalledVersion[]>([])
  const [instances, setInstances] = useState<Instance[]>([])
  const [remote, setRemote] = useState<RemoteVersion[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState<string | null>(null)
  const [java, setJava] = useState<JavaInfo | null>(null)
  const [appVersions, setAppVersions] = useState<AppVersions>(EMPTY_VERSIONS)
  const [paths, setPaths] = useState<PathsState>(EMPTY_PATHS)
  const [install, setInstall] = useState<InstallProgress | null>(null)
  const [launch, setLaunch] = useState<LaunchState>({ status: 'idle' })
  const [logs, setLogs] = useState<LaunchLog[]>([])
  const [microsoft, setMicrosoft] = useState<MicrosoftState>(EMPTY_MICROSOFT)
  const installInFlight = useRef(false)

  const refreshRemoteVersions = useCallback(
    async (force = false): Promise<void> => {
      setRemoteLoading(true)
      setRemoteError(null)
      try {
        setRemote(await unwrap(window.cerberus.listRemoteVersions(force)))
      } catch (error) {
        setRemoteError(messageOf(error))
      } finally {
        setRemoteLoading(false)
      }
    },
    []
  )

  const refreshInstances = useCallback(async (): Promise<void> => {
    try {
      setInstances(await unwrap(window.cerberus.listInstances()))
    } catch (error) {
      toast.error(messageOf(error))
    }
  }, [toast])

  const retryBootstrap = useCallback(async (): Promise<void> => {
    setReady(false)
    setFatalError(null)

    try {
      const data = await unwrap(window.cerberus.bootstrap())
      setSettings(data.settings)
      setAccounts(data.accounts)
      setActiveAccountId(data.activeAccountId)
      setInstalled(data.installedVersions)
      setInstances(data.instances)
      setJava(data.java)
      setAppVersions(data.versions)
      setPaths({
        dataDirectory: data.dataDirectory,
        logsDirectory: data.logsDirectory,
        defaultGameDirectory: data.defaultGameDirectory
      })

      try {
        setLaunch(await unwrap(window.cerberus.getLaunchState()))
      } catch {
        // Состояние запуска не критично для старта UI.
      }

      setReady(true)
      void refreshRemoteVersions(false)
    } catch (error) {
      setFatalError(messageOf(error))
      setReady(true)
    }
  }, [refreshRemoteVersions])

  useEffect(() => {
    void retryBootstrap()
  }, [retryBootstrap])

  useEffect(() => {
    const unsubscribe = [
      window.cerberus.onInstallProgress((progress) => setInstall(progress)),
      window.cerberus.onLaunchLog((line) => {
        setLogs((current) => [...current.slice(-1499), line])
      }),
      window.cerberus.onLaunchState((state) => setLaunch(state)),
      window.cerberus.onAuthStatus((status) => {
        setMicrosoft((current) => ({
          ...current,
          phase: status.phase,
          message: status.message ?? current.message
        }))
      }),
      window.cerberus.onAuthSuccess((result) => {
        setAccounts(result.accounts)
        setActiveAccountId(result.activeAccountId)
        setMicrosoft(EMPTY_MICROSOFT)
        toast.success(`Вход выполнен: ${result.account.username}`)
      }),
      window.cerberus.onAuthError((error) => {
        setMicrosoft({ ...EMPTY_MICROSOFT, error: error.error })
        toast.error(error.error)
      })
    ]

    return () => {
      for (const off of unsubscribe) off()
    }
  }, [toast])

  const refreshInstalled = useCallback(async (): Promise<void> => {
    try {
      setInstalled(await unwrap(window.cerberus.listInstalledVersions()))
    } catch (error) {
      toast.error(messageOf(error))
    }
  }, [toast])

  const installVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      if (installInFlight.current) {
        toast.info('Установка уже идёт. Дождитесь её завершения.')
        return false
      }

      installInFlight.current = true
      try {
        const result = await unwrap(window.cerberus.installVersion(versionId))
        if (result.cancelled) {
          toast.info('Установка отменена')
          return false
        }
        if (!result.ok) {
          toast.error(result.error ?? 'Не удалось установить версию')
          return false
        }

        setInstalled(await unwrap(window.cerberus.listInstalledVersions()))
        toast.success(`Версия ${versionId} установлена`)
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      } finally {
        installInFlight.current = false
        setInstall(null)
      }
    },
    [toast]
  )

  const cancelInstall = useCallback(async (): Promise<void> => {
    if (!install) return
    try {
      const cancelled = await unwrap(window.cerberus.cancelInstall(install.taskId))
      if (cancelled) toast.info('Отменяем установку…')
    } catch (error) {
      toast.error(messageOf(error))
    }
  }, [install, toast])

  const launchVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      if (!activeAccountId) {
        toast.error('Сначала добавьте аккаунт.')
        return false
      }
      if (installInFlight.current) {
        toast.info('Дождитесь завершения установки.')
        return false
      }

      try {
        await unwrap(window.cerberus.launchVersion(versionId))
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [activeAccountId, toast]
  )

  const launchInstance = useCallback(
    async (instanceId: string): Promise<boolean> => {
      if (!activeAccountId) {
        toast.error('Сначала добавьте аккаунт.')
        return false
      }
      if (installInFlight.current) {
        toast.info('Дождитесь завершения установки.')
        return false
      }

      try {
        await unwrap(window.cerberus.launchInstance(instanceId))
        setInstances((current) =>
          current.map((instance) =>
            instance.id === instanceId
              ? { ...instance, lastPlayedAt: Date.now() }
              : instance
          )
        )
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [activeAccountId, toast]
  )

  const stopGame = useCallback(async (): Promise<void> => {
    try {
      await unwrap(window.cerberus.stopGame())
    } catch (error) {
      toast.error(messageOf(error))
    }
  }, [toast])

  const deleteVersion = useCallback(
    async (versionId: string): Promise<boolean> => {
      try {
        setInstalled(await unwrap(window.cerberus.deleteVersion(versionId)))
        toast.success(`Версия ${versionId} удалена`)
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const createInstance = useCallback(
    async (request: CreateInstanceRequest): Promise<TaskResult | null> => {
      if (installInFlight.current) {
        toast.info('Дождитесь завершения текущей операции.')
        return null
      }

      installInFlight.current = true
      try {
        const result = await unwrap(window.cerberus.createInstance(request))
        if (result.cancelled) {
          toast.info('Создание инстанса отменено')
          return null
        }
        if (!result.ok) {
          toast.error(result.error ?? 'Не удалось создать инстанс')
          return null
        }

        await refreshInstances()
        toast.success(`Инстанс «${request.name}» создан`)
        return result
      } catch (error) {
        toast.error(messageOf(error))
        return null
      } finally {
        installInFlight.current = false
        setInstall(null)
      }
    },
    [refreshInstances, toast]
  )

  const deleteInstance = useCallback(
    async (instanceId: string): Promise<boolean> => {
      try {
        setInstances(await unwrap(window.cerberus.deleteInstance(instanceId)))
        toast.success('Инстанс удалён')
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const openInstancePath = useCallback(
    async (instanceId: string, target: InstancePathTarget = 'root'): Promise<void> => {
      try {
        await unwrap(window.cerberus.openInstancePath(instanceId, target))
      } catch (error) {
        toast.error(messageOf(error))
      }
    },
    [toast]
  )

  const listLoaderVersions = useCallback(
    async (loader: LoaderType, minecraftVersion: string): Promise<LoaderVersionInfo[]> => {
      try {
        return await unwrap(window.cerberus.listLoaderVersions(loader, minecraftVersion))
      } catch (error) {
        toast.error(messageOf(error))
        return []
      }
    },
    [toast]
  )

  const listInstanceContent = useCallback(
    async (instanceId: string): Promise<InstanceContent[]> => {
      try {
        return await unwrap(window.cerberus.listInstanceContent(instanceId))
      } catch (error) {
        toast.error(messageOf(error))
        return []
      }
    },
    [toast]
  )

  const removeInstanceContent = useCallback(
    async (instanceId: string, contentId: string): Promise<boolean> => {
      try {
        await unwrap(window.cerberus.removeInstanceContent(instanceId, contentId))
        await refreshInstances()
        toast.success('Файл контента удалён')
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [refreshInstances, toast]
  )

  const searchCatalog = useCallback(
    async (request: CatalogSearchRequest): Promise<CatalogSearchResult> => {
      return unwrap(window.cerberus.searchCatalog(request))
    },
    []
  )

  const featuredModpacks = useCallback(async (): Promise<CatalogProject[]> => {
    return unwrap(window.cerberus.featuredModpacks())
  }, [])

  const listCatalogVersions = useCallback(
    async (
      source: CatalogSource,
      projectId: string,
      type: ContentType,
      gameVersion?: string,
      loader?: LoaderType
    ): Promise<CatalogVersion[]> => {
      return unwrap(
        window.cerberus.listCatalogVersions(source, projectId, type, gameVersion, loader)
      )
    },
    []
  )

  const installModpack = useCallback(
    async (request: InstallModpackRequest): Promise<TaskResult | null> => {
      if (installInFlight.current) {
        toast.info('Дождитесь завершения текущей операции.')
        return null
      }

      installInFlight.current = true
      try {
        const result = await unwrap(window.cerberus.installModpack(request))
        if (result.cancelled) {
          toast.info('Установка сборки отменена')
          return null
        }
        if (!result.ok) {
          toast.error(result.error ?? 'Не удалось установить сборку')
          return null
        }

        await refreshInstances()
        toast.success('Сборка установлена')
        return result
      } catch (error) {
        toast.error(messageOf(error))
        return null
      } finally {
        installInFlight.current = false
        setInstall(null)
      }
    },
    [refreshInstances, toast]
  )

  const installContent = useCallback(
    async (request: InstallContentRequest): Promise<ContentInstallResult | null> => {
      if (installInFlight.current) {
        toast.info('Дождитесь завершения текущей операции.')
        return null
      }

      installInFlight.current = true
      try {
        const result = await unwrap(window.cerberus.installContent(request))
        await refreshInstances()
        toast.success(`Установлено: ${result.content.name}`)
        return result
      } catch (error) {
        toast.error(messageOf(error))
        return null
      } finally {
        installInFlight.current = false
        setInstall(null)
      }
    },
    [refreshInstances, toast]
  )

  const checkCurseForge = useCallback(
    async (apiKey: string): Promise<boolean> => {
      try {
        return await unwrap(window.cerberus.checkCurseForge(apiKey))
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const addOfflineAccount = useCallback(
    async (username: string): Promise<boolean> => {
      try {
        const result = await unwrap(window.cerberus.addOfflineAccount(username))
        setAccounts(result.accounts)
        setActiveAccountId(result.activeAccountId)
        toast.success(`Аккаунт ${result.account.username} добавлен`)
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const removeAccount = useCallback(
    async (accountId: string): Promise<boolean> => {
      try {
        const result = await unwrap(window.cerberus.removeAccount(accountId))
        setAccounts(result.accounts)
        setActiveAccountId(result.activeAccountId)
        toast.success('Аккаунт удалён')
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const setActiveAccount = useCallback(
    async (accountId: string): Promise<void> => {
      try {
        const result = await unwrap(window.cerberus.setActiveAccount(accountId))
        setAccounts(result.accounts)
        setActiveAccountId(result.activeAccountId)
      } catch (error) {
        toast.error(messageOf(error))
      }
    },
    [toast]
  )

  const startMicrosoftLogin = useCallback(async (): Promise<void> => {
    setMicrosoft((current) => ({ ...current, error: null }))
    try {
      const device = await unwrap(window.cerberus.startMicrosoftLogin())
      setMicrosoft({ device, phase: 'waiting', message: null, error: null })
    } catch (error) {
      const message = messageOf(error)
      setMicrosoft({ ...EMPTY_MICROSOFT, error: message })
      toast.error(message)
    }
  }, [toast])

  const cancelMicrosoftLogin = useCallback(async (): Promise<void> => {
    const flowId = microsoft.device?.flowId
    if (!flowId) {
      setMicrosoft(EMPTY_MICROSOFT)
      return
    }

    try {
      await unwrap(window.cerberus.cancelMicrosoftLogin(flowId))
      setMicrosoft(EMPTY_MICROSOFT)
      toast.info('Вход отменён')
    } catch (error) {
      toast.error(messageOf(error))
    }
  }, [microsoft.device, toast])

  const dismissMicrosoftError = useCallback((): void => {
    setMicrosoft((current) => ({ ...current, error: null }))
  }, [])

  const saveSettings = useCallback(
    async (patch: Partial<Settings>): Promise<boolean> => {
      try {
        const result = await unwrap(window.cerberus.updateSettings(patch))
        setSettings(result.settings)
        setInstalled(result.installedVersions)
        setInstances(result.instances)

        const javaList = await unwrap(window.cerberus.detectJava())
        const selected =
          javaList.find(
            (item) => item.path.toLowerCase() === result.settings.javaPath?.toLowerCase()
          ) ??
          javaList[0] ??
          null
        setJava(selected)

        toast.success('Настройки сохранены')
        return true
      } catch (error) {
        toast.error(messageOf(error))
        return false
      }
    },
    [toast]
  )

  const detectJava = useCallback(async (): Promise<JavaInfo[]> => {
    try {
      return await unwrap(window.cerberus.detectJava())
    } catch (error) {
      toast.error(messageOf(error))
      return []
    }
  }, [toast])

  const pickPath = useCallback(
    async (kind: PickPathKind): Promise<string | null> => {
      try {
        return await unwrap(window.cerberus.pickPath(kind))
      } catch (error) {
        toast.error(messageOf(error))
        return null
      }
    },
    [toast]
  )

  const openPath = useCallback(
    async (kind: PathKind): Promise<void> => {
      try {
        await unwrap(window.cerberus.openPath(kind))
      } catch (error) {
        toast.error(messageOf(error))
      }
    },
    [toast]
  )

  const openExternal = useCallback(
    async (url: string): Promise<void> => {
      try {
        await unwrap(window.cerberus.openExternal(url))
      } catch (error) {
        toast.error(messageOf(error))
      }
    },
    [toast]
  )

  const clearLogs = useCallback((): void => {
    setLogs([])
  }, [])

  const activeAccount = useMemo(
    () => accounts.find((account) => account.id === activeAccountId) ?? null,
    [accounts, activeAccountId]
  )

  const value: LauncherContextValue = {
    ready,
    fatalError,
    settings,
    accounts,
    activeAccountId,
    activeAccount,
    installed,
    instances,
    remote,
    remoteLoading,
    remoteError,
    java,
    appVersions,
    paths,
    install,
    launch,
    logs,
    microsoft,
    refreshRemoteVersions,
    refreshInstalled,
    refreshInstances,
    installVersion,
    cancelInstall,
    launchVersion,
    launchInstance,
    stopGame,
    deleteVersion,
    createInstance,
    deleteInstance,
    openInstancePath,
    listLoaderVersions,
    listInstanceContent,
    removeInstanceContent,
    searchCatalog,
    featuredModpacks,
    listCatalogVersions,
    installModpack,
    installContent,
    checkCurseForge,
    addOfflineAccount,
    removeAccount,
    setActiveAccount,
    startMicrosoftLogin,
    cancelMicrosoftLogin,
    dismissMicrosoftError,
    saveSettings,
    detectJava,
    pickPath,
    openPath,
    openExternal,
    clearLogs,
    retryBootstrap
  }

  return <LauncherContext.Provider value={value}>{children}</LauncherContext.Provider>
}

export function useLauncher(): LauncherContextValue {
  const context = useContext(LauncherContext)
  if (!context) throw new Error('useLauncher must be used inside LauncherProvider')
  return context
}
