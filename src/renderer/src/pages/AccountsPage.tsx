import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Account } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import { AccountAvatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  AlertIcon,
  CheckIcon,
  ExternalIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon
} from '../components/Icons'
import { EmptyState, PageHeader } from '../components/Layout'
import { formatDateTime, shortUuid } from '../lib/format'

export function AccountsPage() {
  const navigate = useNavigate()
  const {
    settings,
    accounts,
    activeAccount,
    addOfflineAccount,
    removeAccount,
    setActiveAccount,
    microsoft,
    startMicrosoftLogin,
    cancelMicrosoftLogin,
    dismissMicrosoftError,
    openExternal
  } = useLauncher()

  const [username, setUsername] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)

  const hasClientId = Boolean(settings.microsoftClientId)
  const microsoftBusy = microsoft.device !== null

  const handleOffline = async (): Promise<void> => {
    const name = username.trim()
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
      setFormError('3–16 символов: латиница, цифры и подчёркивание.')
      return
    }

    setSubmitting(true)
    setFormError(null)
    const ok = await addOfflineAccount(name)
    setSubmitting(false)
    if (ok) setUsername('')
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Аккаунты"
        title="Профили игроков"
        description="Microsoft-вход для официальных серверов и офлайн-профили для локальной игры."
      />

      <div className="accounts-layout">
        <div className="accounts-main">
          {activeAccount ? (
            <section className="panel profile-panel">
              <div className="profile-panel__identity">
                <AccountAvatar account={activeAccount} size={92} />
                <div>
                  <span className="eyebrow">Активный профиль</span>
                  <h2>{activeAccount.username}</h2>
                  <div className="profile-panel__badges">
                    <span className={`badge badge--${activeAccount.type === 'microsoft' ? 'accent' : 'success'}`}>
                      {activeAccount.type === 'microsoft' ? 'Microsoft' : 'Офлайн'}
                    </span>
                    <span className="badge">UUID {shortUuid(activeAccount.uuid)}</span>
                  </div>
                </div>
              </div>
              <p className="profile-panel__note">
                {activeAccount.type === 'microsoft'
                  ? activeAccount.skinUrl
                    ? 'Скин загружен из профиля Mojang. Загрузка собственных скинов появится позже.'
                    : 'Профиль Microsoft подключён. Скин подтянется при следующем обновлении сессии.'
                  : 'Офлайн-профиль использует стандартный скин. Загрузка скинов — в следующей итерации.'}
              </p>
            </section>
          ) : (
            <section className="panel">
              <EmptyState
                icon={<UserIcon size={30} />}
                title="Аккаунт не выбран"
                description="Добавьте офлайн-профиль или войдите через Microsoft, чтобы запускать игру."
              />
            </section>
          )}

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="eyebrow">Профили</span>
                <h3>Сохранённые аккаунты</h3>
              </div>
              <span className="badge">{accounts.length}</span>
            </div>

            {accounts.length === 0 ? (
              <p className="muted">
                Пока пусто. Создайте офлайн-профиль справа или подключите Microsoft.
              </p>
            ) : (
              <div className="account-list">
                {accounts.map((account) => {
                  const active = account.id === activeAccount?.id
                  return (
                    <div
                      key={account.id}
                      className={`account-row${active ? ' account-row--active' : ''}`}
                    >
                      <AccountAvatar account={account} size={44} />
                      <div className="account-row__info">
                        <div className="account-row__title">
                          <strong>{account.username}</strong>
                          {active ? (
                            <span className="badge badge--success">
                              <CheckIcon size={12} /> Активен
                            </span>
                          ) : null}
                        </div>
                        <small>
                          {account.type === 'microsoft' ? 'Microsoft' : 'Офлайн'} ·{' '}
                          {shortUuid(account.uuid)} · добавлен {formatDateTime(account.createdAt)}
                        </small>
                      </div>
                      <div className="account-row__actions">
                        {!active ? (
                          <button
                            type="button"
                            className="btn btn--secondary btn--small"
                            onClick={() => void setActiveAccount(account.id)}
                          >
                            Выбрать
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          onClick={() => setDeleteTarget(account)}
                          aria-label={`Удалить аккаунт ${account.username}`}
                          title="Удалить аккаунт"
                        >
                          <TrashIcon size={17} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="accounts-side">
          <section className="panel auth-panel">
            <div className="auth-panel__head">
              <span className="auth-panel__icon">
                <ShieldIcon size={22} />
              </span>
              <div>
                <span className="eyebrow">Официальный вход</span>
                <h3>Microsoft</h3>
              </div>
            </div>

            {microsoft.error ? (
              <div className="callout callout--error callout--stacked">
                <div>
                  <AlertIcon size={18} />
                  <span>{microsoft.error}</span>
                </div>
                <button type="button" className="btn btn--ghost btn--small" onClick={dismissMicrosoftError}>
                  Закрыть
                </button>
              </div>
            ) : null}

            {microsoft.device && !microsoft.error ? (
              <div className="device-flow">
                <p className="muted">Откройте страницу Microsoft и введите код:</p>
                <code className="device-code">{microsoft.device.userCode}</code>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void openExternal(microsoft.device!.verificationUri)}
                >
                  <ExternalIcon size={16} />
                  Открыть страницу входа
                </button>
                <div className="device-flow__status">
                  <span className="spinner spinner--small" />
                  <span>
                    {microsoft.phase === 'authorizing'
                      ? 'Авторизуемся в Xbox Live…'
                      : microsoft.phase === 'finishing'
                        ? 'Сохраняем профиль…'
                        : microsoft.message ?? 'Ждём подтверждения в браузере…'}
                  </span>
                </div>
                <p className="device-flow__expires">
                  Код действует до {formatDateTime(microsoft.device.expiresAt)}
                </p>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => void cancelMicrosoftLogin()}
                >
                  Отменить вход
                </button>
              </div>
            ) : !hasClientId ? (
              <div className="auth-panel__setup">
                <p>
                  Для входа нужен Client ID приложения Microsoft Entra. Это разовая настройка
                  для вашего лаунчера.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => navigate('/settings')}
                >
                  Указать Client ID
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() =>
                    void openExternal(
                      'https://learn.microsoft.com/entra/identity-platform/v2-oauth2-device-code'
                    )
                  }
                >
                  <ExternalIcon size={14} />
                  Как это работает
                </button>
              </div>
            ) : (
              <div className="auth-panel__setup">
                <p>
                  Вход откроет страницу Microsoft. Лаунчер не видит пароль и хранит токены
                  в зашифрованном виде средствами ОС.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => void startMicrosoftLogin()}
                  disabled={microsoftBusy}
                >
                  <ShieldIcon size={17} />
                  Войти через Microsoft
                </button>
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel__head">
              <div>
                <span className="eyebrow">Без интернета</span>
                <h3>Офлайн-профиль</h3>
              </div>
              <PlusIcon size={18} />
            </div>

            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault()
                void handleOffline()
              }}
            >
              <label className="field">
                <span>Ник игрока</span>
                <input
                  className="input"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value)
                    setFormError(null)
                  }}
                  placeholder="Steve"
                  maxLength={16}
                  autoComplete="off"
                  disabled={submitting}
                />
                <small>3–16 символов: A–Z, 0–9 и подчёркивание.</small>
              </label>

              {formError ? <p className="form-error">{formError}</p> : null}

              <button type="submit" className="btn btn--secondary" disabled={submitting}>
                {submitting ? <span className="spinner spinner--small" /> : <PlusIcon size={17} />}
                {submitting ? 'Добавляем…' : 'Добавить профиль'}
              </button>
            </form>
          </section>

          <section className="panel panel--muted">
            <span className="eyebrow">Безопасность</span>
            <p className="muted">
              Пароли Microsoft не попадают в лаунчер. Refresh- и access-токены хранятся
              локально в зашифрованном виде; рендерер их не получает.
            </p>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить аккаунт?"
        description={
          deleteTarget
            ? `Профиль ${deleteTarget.username} и сохранённые токены будут удалены с этого компьютера.`
            : ''
        }
        confirmLabel="Удалить"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void removeAccount(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
