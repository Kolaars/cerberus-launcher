import { app, BrowserWindow, Menu, dialog } from 'electron'
import { IPC_EVENTS } from '@shared/ipc'
import { AccountStore } from './services/account-store'
import { CatalogService } from './services/catalog'
import { ConfigStore } from './services/config-store'
import { InstanceService } from './services/instances'
import { JavaService } from './services/java'
import { ModLoaderRegistry, ModLoaderService } from './services/modloader'
import { ContentService } from './services/modpack'
import { AppPaths } from './services/paths'
import { InstalledService } from './services/minecraft/installed'
import { InstallerService } from './services/minecraft/installer'
import { GameLauncher } from './services/minecraft/launcher'
import { VersionManifestService } from './services/minecraft/version-manifest'
import { registerIpc } from './ipc'
import { initLogger, log } from './utils/logger'
import { TaskManager } from './utils/task-manager'
import { createMainWindow } from './window'

app.setName('Cerberus Launcher')

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let tasksRef: TaskManager | null = null
  let accountsRef: AccountStore | null = null

  process.on('uncaughtException', (error) => {
    log.error('process', error)
  })
  process.on('unhandledRejection', (reason) => {
    log.error('process', reason)
  })

  const send = (channel: string, payload: unknown): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
  }

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId('com.cerberus.launcher')
      Menu.setApplicationMenu(null)

      const paths = new AppPaths()
      initLogger(paths.logsDirectory)
      log.info('app', `Cerberus Launcher ${app.getVersion()} запускается`)

      const config = new ConfigStore(paths)
      const tasks = new TaskManager()
      tasksRef = tasks
      const java = new JavaService(config)
      const manifest = new VersionManifestService(paths)
      const instances = new InstanceService(config)
      const installed = new InstalledService(config, instances)

      const accounts = new AccountStore(paths, config, {
        onStatus: (status) => send(IPC_EVENTS.authStatus, status),
        onSuccess: (result) => send(IPC_EVENTS.authSuccess, result),
        onError: (error) => send(IPC_EVENTS.authError, error)
      })
      accountsRef = accounts

      const installer = new InstallerService(
        manifest,
        installed,
        instances,
        tasks,
        (progress) => send(IPC_EVENTS.installProgress, progress),
        (result) => send(IPC_EVENTS.installDone, result)
      )

      const loaders = new ModLoaderRegistry(
        new ModLoaderService(
          java,
          instances,
          installed,
          () => paths.cacheDirectory,
          (progress) => send(IPC_EVENTS.installProgress, progress)
        )
      )

      const catalog = new CatalogService(config)

      const content = new ContentService(
        config,
        instances,
        catalog,
        loaders,
        installer,
        (progress) => send(IPC_EVENTS.installProgress, progress)
      )

      const launcher = new GameLauncher(
        config,
        installed,
        instances,
        accounts,
        java,
        (line) => send(IPC_EVENTS.launchLog, line),
        (state) => send(IPC_EVENTS.launchState, state)
      )

      registerIpc(
        {
          paths,
          config,
          accounts,
          java,
          manifest,
          installed,
          instances,
          installer,
          loaders,
          catalog,
          content,
          launcher
        },
        () => mainWindow
      )

      mainWindow = createMainWindow()
      mainWindow.on('closed', () => {
        mainWindow = null
      })

      app.on('activate', () => {
        if (mainWindow) return
        mainWindow = createMainWindow()
        mainWindow.on('closed', () => {
          mainWindow = null
        })
      })
    })
    .catch((error) => {
      log.error('app', error)
      dialog.showErrorBox(
        'Cerberus Launcher',
        `Не удалось запустить приложение:\n${error instanceof Error ? error.message : String(error)}`
      )
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    // Отмена незавершённых загрузок. Запущенная игра продолжает работать:
    // лаунчер можно закрыть, не прерывая игровую сессию.
    tasksRef?.cancelAll()
    accountsRef?.dispose()
  })

  app.on('render-process-gone', (_event, _webContents, details) => {
    log.error('renderer', `Renderer завершился: ${details.reason}`)
  })
}
