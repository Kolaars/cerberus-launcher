import { NavLink } from 'react-router-dom'
import { useLauncher } from '../context/LauncherContext'
import { AccountAvatar } from './Avatar'
import {
  BoxIcon,
  ChevronDownIcon,
  LayersIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon
} from './Icons'

const NAV_ITEMS = [
  { to: '/', label: 'Играть', icon: PlayIcon, end: true },
  { to: '/versions', label: 'Версии', icon: LayersIcon, end: false },
  { to: '/modpacks', label: 'Модпаки', icon: BoxIcon, end: false },
  { to: '/accounts', label: 'Аккаунты', icon: UserIcon, end: false },
  { to: '/settings', label: 'Настройки', icon: SettingsIcon, end: false }
]

export function Sidebar() {
  const { activeAccount, java, appVersions } = useLauncher()

  return (
    <aside className="sidebar">
      <div className="sidebar__label">Навигация</div>
      <nav className="sidebar__nav" aria-label="Основная навигация">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
            >
              <span className="nav-item__icon">
                <Icon size={17} />
              </span>
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar__spacer" />

      <div className={`sidebar__status${java ? '' : ' sidebar__status--warning'}`}>
        <span className="status-dot" />
        <span>
          {java ? `Java ${java.major}` : 'Java не найдена'}
          {java ? <small>{java.version}</small> : null}
        </span>
      </div>

      <NavLink to="/accounts" className="account-chip">
        <AccountAvatar account={activeAccount} size={38} />
        <span className="account-chip__text">
          <strong>{activeAccount?.username ?? 'Добавить аккаунт'}</strong>
          <small>
            {activeAccount
              ? activeAccount.type === 'microsoft'
                ? 'Microsoft'
                : 'Офлайн-режим'
              : 'Профиль не выбран'}
          </small>
        </span>
        {activeAccount ? <ChevronDownIcon size={16} /> : <PlusIcon size={16} />}
      </NavLink>

      <div className="sidebar__footer">
        <span>CERBERUS</span>
        <span>v{appVersions.app || '0.1.0'}</span>
      </div>
    </aside>
  )
}
