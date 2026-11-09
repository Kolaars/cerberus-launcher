import { useEffect, useState } from 'react'
import { useLauncher } from '../context/LauncherContext'
import { CloseIcon, MaximizeIcon, MinusIcon, RestoreIcon } from './Icons'
import { LogoMark } from './Logo'

export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    void window.cerberus.windowIsMaximized().then((value) => {
      if (mounted) setMaximized(value)
    })
    const unsubscribe = window.cerberus.onWindowMaximized(setMaximized)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  return (
    <div
      className={`titlebar__controls${className ? ` ${className}` : ''}`}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="window-button"
        onClick={() => window.cerberus.windowMinimize()}
        aria-label="Свернуть окно"
      >
        <MinusIcon />
      </button>
      <button
        type="button"
        className="window-button"
        onClick={() => window.cerberus.windowToggleMaximize()}
        aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className="window-button window-button--close"
        onClick={() => window.cerberus.windowClose()}
        aria-label="Закрыть окно"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

export function TitleBar() {
  const { appVersions } = useLauncher()

  return (
    <header
      className="titlebar"
      onDoubleClick={() => window.cerberus.windowToggleMaximize()}
    >
      <div className="titlebar__brand">
        <span className="titlebar__mark">
          <LogoMark size={19} />
        </span>
        <span className="titlebar__name">CERBERUS</span>
        <span className="titlebar__sub">LAUNCHER</span>
        {appVersions.app ? <span className="titlebar__version">v{appVersions.app}</span> : null}
      </div>

      <WindowControls />
    </header>
  )
}
