import { contextBridge, ipcRenderer } from 'electron'
import { IPC, IPC_EVENTS, type CerberusApi } from '@shared/ipc'
import type { IpcResult } from '@shared/result'

function invoke<T>(channel: string, ...args: unknown[]): Promise<IpcResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: CerberusApi = {
  bootstrap: () => invoke(IPC.bootstrap),

  listRemoteVersions: (force) => invoke(IPC.listRemoteVersions, force),
  listInstalledVersions: () => invoke(IPC.listInstalledVersions),
  installVersion: (versionId) => invoke(IPC.installVersion, versionId),
  cancelInstall: (taskId) => invoke(IPC.cancelInstall, taskId),
  deleteVersion: (versionId) => invoke(IPC.deleteVersion, versionId),
  launchVersion: (versionId) => invoke(IPC.launchVersion, versionId),
  stopGame: () => invoke(IPC.stopGame),
  getLaunchState: () => invoke(IPC.getLaunchState),

  listInstances: () => invoke(IPC.listInstances),
  getInstance: (instanceId) => invoke(IPC.getInstance, instanceId),
  createInstance: (request) => invoke(IPC.createInstance, request),
  deleteInstance: (instanceId) => invoke(IPC.deleteInstance, instanceId),
  launchInstance: (instanceId) => invoke(IPC.launchInstance, instanceId),
  openInstancePath: (instanceId, target) =>
    invoke(IPC.openInstancePath, instanceId, target),
  listLoaderVersions: (loader, minecraftVersion) =>
    invoke(IPC.listLoaderVersions, loader, minecraftVersion),
  listInstanceContent: (instanceId) => invoke(IPC.listInstanceContent, instanceId),
  removeInstanceContent: (instanceId, contentId) =>
    invoke(IPC.removeInstanceContent, instanceId, contentId),

  searchCatalog: (request) => invoke(IPC.searchCatalog, request),
  featuredModpacks: () => invoke(IPC.featuredModpacks),
  listCatalogVersions: (source, projectId, type, gameVersion, loader) =>
    invoke(IPC.listCatalogVersions, source, projectId, type, gameVersion, loader),
  installModpack: (request) => invoke(IPC.installModpack, request),
  installContent: (request) => invoke(IPC.installContent, request),
  checkCurseForge: (apiKey) => invoke(IPC.checkCurseForge, apiKey),

  addOfflineAccount: (username) => invoke(IPC.addOfflineAccount, username),
  removeAccount: (accountId) => invoke(IPC.removeAccount, accountId),
  setActiveAccount: (accountId) => invoke(IPC.setActiveAccount, accountId),
  startMicrosoftLogin: () => invoke(IPC.startMicrosoftLogin),
  cancelMicrosoftLogin: (flowId) => invoke(IPC.cancelMicrosoftLogin, flowId),

  updateSettings: (patch) => invoke(IPC.updateSettings, patch),
  detectJava: () => invoke(IPC.detectJava),

  pickPath: (kind) => invoke(IPC.pickPath, kind),
  openPath: (kind) => invoke(IPC.openPath, kind),
  openExternal: (url) => invoke(IPC.openExternal, url),

  windowMinimize: () => ipcRenderer.send(IPC.windowMinimize),
  windowToggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
  windowClose: () => ipcRenderer.send(IPC.windowClose),
  windowIsMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,

  onInstallProgress: (callback) => subscribe(IPC_EVENTS.installProgress, callback),
  onInstallDone: (callback) => subscribe(IPC_EVENTS.installDone, callback),
  onLaunchLog: (callback) => subscribe(IPC_EVENTS.launchLog, callback),
  onLaunchState: (callback) => subscribe(IPC_EVENTS.launchState, callback),
  onAuthStatus: (callback) => subscribe(IPC_EVENTS.authStatus, callback),
  onAuthSuccess: (callback) => subscribe(IPC_EVENTS.authSuccess, callback),
  onAuthError: (callback) => subscribe(IPC_EVENTS.authError, callback),
  onWindowMaximized: (callback) => subscribe(IPC_EVENTS.windowMaximized, callback)
}

contextBridge.exposeInMainWorld('cerberus', api)
