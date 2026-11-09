import { Component, type ErrorInfo, type ReactNode } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LauncherProvider, useLauncher } from './context/LauncherContext'
import { ToastProvider } from './context/ToastContext'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { PrismLayout } from './components/PrismLayout'
import { LogoMark } from './components/Logo'
import { AlertIcon, RefreshIcon } from './components/Icons'
import { PlayPage } from './pages/PlayPage'
import { PrismHomePage } from './pages/PrismHomePage'
import { VersionsPage } from './pages/VersionsPage'
import { CatalogPage } from './pages/CatalogPage'
import { InstanceDetailPage } from './pages/InstanceDetailPage'
import { AccountsPage } from './pages/AccountsPage'
import { SettingsPage } from './pages/SettingsPage'

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <LauncherProvider>
          <HashRouter>
            <AppFrame />
          </HashRouter>
        </LauncherProvider>
      </ToastProvider>
    </ErrorBoundary>
  )
}

function AppFrame() {
  const { ready, fatalError, retryBootstrap, settings } = useLauncher()
  const booting = !ready
  const failed = ready && fatalError !== null
  const prism = settings.uiMode === 'prism'

  if (!booting && !failed && prism) {
    return (
      <div className="app app--prism">
        <PrismLayout>
          <AppRoutes prism />
        </PrismLayout>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar />
      <div className="app__body">
        {!booting && !failed ? (
          <Sidebar />
        ) : (
          <div className="app__rail" aria-hidden="true">
            <LogoMark size={26} />
          </div>
        )}

        <main className="app__content">
          {booting ? <Splash /> : null}
          {failed ? <BootError message={fatalError ?? ''} onRetry={() => void retryBootstrap()} /> : null}
          {!booting && !failed ? <AppRoutes /> : null}
        </main>
      </div>
    </div>
  )
}

function AppRoutes({ prism = false }: { prism?: boolean }) {
  return (
    <Routes>
      <Route path="/" element={prism ? <PrismHomePage /> : <PlayPage />} />
      <Route path="/catalog" element={<CatalogPage />} />
      <Route path="/versions" element={<VersionsPage />} />
      <Route path="/modpacks" element={<CatalogPage initialType="modpack" />} />
      <Route path="/instances/:instanceId" element={<InstanceDetailPage />} />
      <Route path="/accounts" element={<AccountsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash__emblem">
        <div className="splash__pulse" aria-hidden="true" />
        <LogoMark size={84} />
      </div>
      <div className="splash__text">
        <span className="eyebrow">Cerberus Launcher</span>
        <h1>Открываем врата</h1>
        <p>Проверяем настройки, Java и локальные версии…</p>
      </div>
      <div className="splash__bar" aria-hidden="true">
        <span />
      </div>
    </div>
  )
}

function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="boot-error">
      <span className="boot-error__icon">
        <AlertIcon size={28} />
      </span>
      <h1>Лаунчер не смог загрузиться</h1>
      <p>Сервисы main-процесса вернули ошибку. Проверьте лог и попробуйте снова.</p>
      <pre>{message}</pre>
      <div className="boot-error__actions">
        <button type="button" className="btn btn--primary" onClick={onRetry}>
          <RefreshIcon size={17} />
          Повторить
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
          Перезагрузить интерфейс
        </button>
      </div>
    </div>
  )
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Ошибка интерфейса Cerberus:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="boot-error boot-error--standalone">
          <span className="boot-error__icon">
            <AlertIcon size={28} />
          </span>
          <h1>Интерфейс упал</h1>
          <p>Произошла непредвиденная ошибка React. Подробности — в DevTools.</p>
          <pre>{this.state.error.message}</pre>
          <div className="boot-error__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => this.setState({ error: null })}
            >
              Попробовать снова
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => window.location.reload()}>
              Перезагрузить
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
