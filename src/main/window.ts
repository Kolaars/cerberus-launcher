import { BrowserWindow, app, session, shell } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'

export function createMainWindow(): BrowserWindow {
  configureSession()

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0a0a0f',
    title: 'Cerberus Launcher',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  window.setMenuBarVisibility(false)

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('maximize', () => {
    sendMaximized(window, true)
  })

  window.on('unmaximize', () => {
    sendMaximized(window, false)
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url).catch(() => undefined)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    void openExternalUrl(url).catch(() => undefined)
  })

  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') {
        window.webContents.toggleDevTools()
      }
    })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') {
    throw new Error('Можно открывать только HTTPS-ссылки.')
  }
  await shell.openExternal(parsed.toString())
}

function sendMaximized(window: BrowserWindow, maximized: boolean): void {
  if (window.isDestroyed()) return
  window.webContents.send('window:maximized', maximized)
}

function configureSession(): void {
  const defaultSession = session.defaultSession

  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })

  if (!app.isPackaged) return

  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https://textures.minecraft.net https://cdn.modrinth.com https://media.forgecdn.net https://edge.forgecdn.net",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
            "frame-ancestors 'none'"
          ].join('; ')
        ]
      }
    })
  })
}
