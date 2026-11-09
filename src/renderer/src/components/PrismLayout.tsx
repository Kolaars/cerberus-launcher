import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useLauncher } from '../context/LauncherContext'
import { plural } from '../lib/format'
import { AccountAvatar } from './Avatar'
import { WindowControls } from './TitleBar'
import { LogoMark } from './Logo'
import {
  CompassIcon,
  GridIcon,
  LayersIcon,
  PlayIcon,
  SettingsIcon,
  StopIcon,
  UserIcon
} from './Icons'

const NAV_ITEMS = [
  { to: '/', label: 'Главная', icon: GridIcon, end: true },
  { to: '/catalog', label: 'Каталог', icon: CompassIcon, end: false },
  { to: '/versions', label: 'Vanilla', icon: LayersIcon, end: false },
  { to: '/accounts', label: 'Аккаунты', icon: UserIcon, end: false },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon, end: false }
]

export function PrismLayout({ children }: { children: ReactNode }) {
  const { activeAccount, launch, stopGame, instances } = useLauncher()
  const running = ['starting', 'running', 'stopping'].includes(launch.status)
  const activeInstance = instances.find((instance) => instance.id === launch.instanceId)

  return (
    <div className="app__body app__body--prism">
      <header
        className="prism-nav"
        onDoubleClick={() => window.cerberus.windowToggleMaximize()}
      >
        <NavLink to="/" className="prism-brand" aria-label="Cerberus — главная">
          <span className="prism-brand__mark">
            <LogoMark size={24} />
          </span>
          <span className="prism-brand__text">
            <strong>CERBERUS</strong>
            <small>PRISM</small>
          </span>
        </NavLink>

        <nav className="prism-nav__links" aria-label="Основная навигация">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) =>
                  `prism-nav__link${isActive ? ' prism-nav__link--active' : ''}`
                }
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="prism-nav__right">
          {running ? (
            <button
              type="button"
              className="prism-running"
              onClick={() => void stopGame()}
              title="Остановить игру"
            >
              <span className={`status-dot status-dot--${launch.status}`} />
              <span>
                <strong>{activeInstance?.name ?? launch.versionId ?? 'Minecraft'}</strong>
                <small>Игра запущена · остановить</small>
              </span>
              <StopIcon size={14} />
            </button>
          ) : (
            <span className="prism-nav__idle">
              <PlayIcon size={13} />
              {instances.length > 0
                ? plural(instances.length, 'инстанс', 'инстанса', 'инстансов')
                : 'Нет инстансов'}
            </span>
          )}

          <NavLink to="/accounts" className="prism-account">
            <AccountAvatar account={activeAccount} size={30} />
            <span>
              <strong>{activeAccount?.username ?? 'Аккаунт'}</strong>
              <small>{activeAccount ? (activeAccount.type === 'microsoft' ? 'Microsoft' : 'Офлайн') : 'Не выбран'}</small>
            </span>
          </NavLink>
        </div>

        <WindowControls className="prism-nav__window" />
      </header>

      <main className="app__content prism-content">{children}</main>
    </div>
  )
}
