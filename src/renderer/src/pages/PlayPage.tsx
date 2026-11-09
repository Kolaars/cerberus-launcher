import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CatalogProject, Instance } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import {
  AlertIcon,
  BoxIcon,
  ChevronDownIcon,
  CoffeeIcon,
  CompassIcon,
  DownloadIcon,
  FolderIcon,
  GridIcon,
  LayersIcon,
  PlayIcon,
  PlusIcon,
  SettingsIcon,
  ShieldIcon,
  SparklesIcon,
  StopIcon,
  UserIcon
} from '../components/Icons'
import { AccountAvatar } from '../components/Avatar'
import { LogoMark } from '../components/Logo'
import { LogConsole } from '../components/LogConsole'
import { ProgressBar } from '../components/ProgressBar'
import { InstanceCard } from '../components/InstanceCard'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectDialog } from '../components/ProjectDialog'
import { CreateInstanceDialog } from '../components/CreateInstanceDialog'
import { STAGE_LABELS, formatDate, formatMemory, pluralWord, versionTypeLabel } from '../lib/format'

interface VersionOption {
  id: string
  type: string
  releaseTime: string
  installed: boolean
}

const ACTIVE_LAUNCH_STATUSES = ['starting', 'running', 'stopping']

export function PlayPage() {
  const navigate = useNavigate()
  const {
    settings,
    activeAccount,
    installed,
    instances,
    remote,
    install,
    installVersion,
    cancelInstall,
    launch,
    launchVersion,
    launchInstance,
    stopGame,
    openInstancePath,
    featuredModpacks,
    logs,
    clearLogs,
    java
  } = useLauncher()

  const [selectedId, setSelectedId] = useState('')
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<CatalogProject | null>(null)
  const [featured, setFeatured] = useState<CatalogProject[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)
  const [featuredError, setFeaturedError] = useState<string | null>(null)

  const options = useMemo<VersionOption[]>(() => {
    const map = new Map<string, VersionOption>()

    for (const version of remote) {
      if (version.type === 'release' || settings.showSnapshots) {
        map.set(version.id, {
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime,
          installed: false
        })
      }
    }

    for (const version of installed) {
      const existing = map.get(version.id)
      if (existing) {
        existing.installed = true
        existing.releaseTime = version.releaseTime
      } else {
        map.set(version.id, {
          id: version.id,
          type: version.type,
          releaseTime: version.releaseTime,
          installed: true
        })
      }
    }

    return [...map.values()].sort(
      (a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime)
    )
  }, [remote, installed, settings.showSnapshots])

  useEffect(() => {
    if (selectedId && options.some((option) => option.id === selectedId)) return
    const preferred =
      installed[0]?.id ??
      options.find((option) => option.type === 'release')?.id ??
      options[0]?.id ??
      ''
    setSelectedId(preferred)
  }, [options, installed, selectedId])

  const selected = options.find((option) => option.id === selectedId)
  const selectedInstalled = installed.find((version) => version.id === selectedId)
  const installedOptions = options.filter((option) => option.installed)
  const availableReleases = options.filter(
    (option) => !option.installed && option.type === 'release'
  )
  const availableSnapshots = options.filter(
    (option) => !option.installed && option.type === 'snapshot'
  )
  const launchActive = ACTIVE_LAUNCH_STATUSES.includes(launch.status)
  const busyNow = busy || install !== null
  const latestRelease = remote.find((version) => version.type === 'release')

  useEffect(() => {
    if (launch.status === 'starting' || launch.status === 'running') setConsoleOpen(true)
  }, [launch.status])

  useEffect(() => {
    let cancelled = false
    setFeaturedLoading(true)
    setFeaturedError(null)

    void featuredModpacks()
      .then((projects) => {
        if (!cancelled) setFeatured(projects)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFeatured([])
          setFeaturedError(error instanceof Error ? error.message : String(error))
        }
      })
      .finally(() => {
        if (!cancelled) setFeaturedLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [featuredModpacks])

  const recentInstances = useMemo(
    () =>
      [...instances]
        .sort(
          (a, b) => (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt)
        )
        .slice(0, 6),
    [instances]
  )

  const totalContent = useMemo(
    () => instances.reduce((sum, instance) => sum + instance.contentCount, 0),
    [instances]
  )

  const playInstance = async (instance: Instance): Promise<void> => {
    if (!activeAccount) {
      navigate('/accounts')
      return
    }
    await launchInstance(instance.id)
  }

  const handlePrimary = async (): Promise<void> => {
    if (!activeAccount) {
      navigate('/accounts')
      return
    }
    if (!selectedId || busyNow || launchActive) return

    setBusy(true)
    try {
      if (!selectedInstalled) {
        const installedOk = await installVersion(selectedId)
        if (!installedOk) return
      }
      const launched = await launchVersion(selectedId)
      if (launched) setConsoleOpen(true)
    } finally {
      setBusy(false)
    }
  }

  const primaryLabel = !activeAccount
    ? 'Добавить аккаунт'
    : busy
      ? selectedInstalled
        ? 'Запускаем…'
        : 'Устанавливаем…'
      : install
        ? 'Идёт установка…'
        : launchActive
          ? 'Игра запущена'
          : !selected
            ? 'Нет версий'
            : selectedInstalled
              ? 'Играть'
              : 'Установить и играть'

  return (
    <div className="page page--play">
      <section className="hero">
        <div className="hero__glow" aria-hidden="true" />
        <div className="hero__grid" aria-hidden="true" />
        <div className="hero__content">
          <span className="eyebrow">Cerberus Launcher · Minecraft</span>
          <h1 className="hero__title">
            Спустись
            <br />
            <span>в игру</span>
          </h1>
          <p className="hero__description">
            Один клик — и Цербер откроет врата. Версии, аккаунты и логи запуска в одном месте.
          </p>

          <button
            type="button"
            className="hero__account"
            onClick={() => navigate('/accounts')}
          >
            <AccountAvatar account={activeAccount} size={46} />
            <span>
              <strong>{activeAccount?.username ?? 'Аккаунт не выбран'}</strong>
              <small>
                {activeAccount
                  ? activeAccount.type === 'microsoft'
                    ? 'Microsoft · лицензионный профиль'
                    : 'Офлайн-профиль'
                  : 'Нажмите, чтобы войти или создать профиль'}
              </small>
            </span>
            <ChevronDownIcon size={16} />
          </button>

          <div className="hero__controls">
            <label className="select-field">
              <span>Версия Minecraft</span>
              <div className="select-wrap">
                <select
                  value={selectedId}
                  onChange={(event) => setSelectedId(event.target.value)}
                  disabled={options.length === 0 || busyNow}
                >
                  {options.length === 0 ? <option value="">Версии не найдены</option> : null}
                  {installedOptions.length > 0 ? (
                    <optgroup label="Установленные">
                      {installedOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {availableReleases.length > 0 ? (
                    <optgroup label="Релизы">
                      {availableReleases.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  {availableSnapshots.length > 0 ? (
                    <optgroup label="Снапшоты">
                      {availableSnapshots.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.id}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </div>
            </label>

            <button
              type="button"
              className="btn btn--primary btn--hero"
              onClick={() => void handlePrimary()}
              disabled={!selectedId || busyNow || launchActive}
            >
              {!activeAccount ? (
                <UserIcon size={21} />
              ) : selectedInstalled ? (
                <PlayIcon size={22} />
              ) : (
                <DownloadIcon size={22} />
              )}
              {primaryLabel}
            </button>
          </div>

          {selected ? (
            <div className="hero__meta">
              <span className={`badge badge--${selected.type === 'release' ? 'success' : 'warning'}`}>
                {versionTypeLabel(selected.type)}
              </span>
              <span>{formatDate(selected.releaseTime)}</span>
              <span className="hero__meta-sep" />
              <span>{selectedInstalled ? 'Установлена' : 'Будет скачана'}</span>
            </div>
          ) : null}
        </div>

        <div className="hero__emblem" aria-hidden="true">
          <div className="hero__emblem-orbit" />
          <div className="hero__emblem-ring" />
          <div className="hero__emblem-core">
            <LogoMark size={158} />
          </div>
          <div className="hero__chip hero__chip--instances">
            <span className="hero__chip-icon">
              <GridIcon size={14} />
            </span>
            <span>
              <strong>{instances.length}</strong>
              <small>{pluralWord(instances.length, 'сборка', 'сборки', 'сборок')}</small>
            </span>
          </div>
          <div className="hero__chip hero__chip--content">
            <span className="hero__chip-icon">
              <BoxIcon size={14} />
            </span>
            <span>
              <strong>{totalContent}</strong>
              <small>{pluralWord(totalContent, 'файл', 'файла', 'файлов')}</small>
            </span>
          </div>
          <div className="hero__chip hero__chip--memory">
            <span className="hero__chip-icon">
              <CoffeeIcon size={14} />
            </span>
            <span>
              <strong>{formatMemory(settings.memoryMb)}</strong>
              <small>памяти</small>
            </span>
          </div>
        </div>
      </section>

      {install ? (
        <section className="panel install-panel">
          <div className="panel__head">
            <div>
              <span className="eyebrow">Установка · {install.versionId}</span>
              <h3>{STAGE_LABELS[install.stage]}</h3>
            </div>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void cancelInstall()}>
              Отменить
            </button>
          </div>
          <ProgressBar percent={install.percent} label="Прогресс установки" />
          <div className="progress-meta">
            <span>{install.message}</span>
            <strong>{install.percent}%</strong>
          </div>
        </section>
      ) : null}

      {launch.status !== 'idle' ? (
        <section
          className={`panel launch-panel launch-panel--${launch.status}`}
          aria-live="polite"
        >
          <div className="launch-panel__info">
            <span className={`status-dot status-dot--${launch.status}`} />
            <div>
              <strong>{launchTitle(launch.status)}</strong>
              <p>{launch.message ?? `Версия ${launch.versionId ?? ''}`}</p>
            </div>
          </div>
          {launch.status === 'starting' || launch.status === 'running' ? (
            <button type="button" className="btn btn--secondary btn--small" onClick={() => void stopGame()}>
              <StopIcon size={16} />
              Остановить
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="stat-grid">
        <article className="stat-card">
          <span className="stat-card__icon">
            <LayersIcon size={20} />
          </span>
          <div>
            <small>Установлено версий</small>
            <strong>{installed.length}</strong>
          </div>
        </article>

        <article className="stat-card">
          <span className="stat-card__icon">
            <BoxIcon size={20} />
          </span>
          <div>
            <small>Инстансы и сборки</small>
            <strong>{instances.length}</strong>
          </div>
        </article>

        <article className={`stat-card${java ? '' : ' stat-card--warning'}`}>
          <span className="stat-card__icon">
            <CoffeeIcon size={20} />
          </span>
          <div>
            <small>Java</small>
            <strong>{java ? `${java.major} · ${java.version}` : 'Не найдена'}</strong>
          </div>
        </article>

        <article className="stat-card stat-card--path">
          <span className="stat-card__icon">
            <FolderIcon size={20} />
          </span>
          <div>
            <small>Папка игры</small>
            <strong title={settings.gameDirectory}>{settings.gameDirectory || '—'}</strong>
          </div>
        </article>
      </section>

      <div className="home-dashboard">
        <section className="home-section home-section--instances">
          <header className="home-section__head">
            <div>
              <span className="eyebrow">
                <BoxIcon size={13} />
                Инстансы
              </span>
              <h2>Мои сборки</h2>
              <p>Изолированные миры с собственными модами, ресурспаками и настройками.</p>
            </div>
            <div className="home-section__actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => navigate('/modpacks')}
              >
                <CompassIcon size={15} />
                Каталог сборок
              </button>
              <button
                type="button"
                className="btn btn--primary btn--small"
                onClick={() => setCreateOpen(true)}
              >
                <PlusIcon size={15} />
                Создать инстанс
              </button>
            </div>
          </header>

          {recentInstances.length === 0 ? (
            <div className="home-empty">
              <span className="home-empty__icon">
                <BoxIcon size={24} />
              </span>
              <div>
                <strong>Сборок пока нет</strong>
                <p>
                  Создайте инстанс с Fabric, Quilt, Forge или NeoForge — и устанавливайте
                  моды и шейдеры в отдельную папку, не трогая остальные версии.
                </p>
              </div>
              <button type="button" className="btn btn--primary btn--small" onClick={() => setCreateOpen(true)}>
                <PlusIcon size={15} />
                Создать
              </button>
            </div>
          ) : (
            <div className="instance-grid instance-grid--classic">
              {recentInstances.map((instance) => (
                <InstanceCard
                  key={instance.id}
                  instance={instance}
                  launch={launch}
                  busy={install !== null || launchActive}
                  onPlay={() => void playInstance(instance)}
                  onStop={() => void stopGame()}
                  onOpen={() => navigate(`/instances/${instance.id}`)}
                  onOpenFolder={() => void openInstancePath(instance.id, 'root')}
                />
              ))}

              <button type="button" className="instance-add" onClick={() => setCreateOpen(true)}>
                <span className="instance-add__icon">
                  <PlusIcon size={22} />
                </span>
                <strong>Новый инстанс</strong>
                <small>Vanilla или модовый загрузчик</small>
              </button>
            </div>
          )}
        </section>

        <aside className="system-panel">
          <div className="system-panel__aura" aria-hidden="true" />
          <header className="system-panel__head">
            <span className="eyebrow">
              <ShieldIcon size={13} />
              Система
            </span>
            <span className={`system-panel__state${java ? '' : ' system-panel__state--warn'}`}>
              <span className={`status-dot${java ? '' : ' status-dot--warning'}`} />
              {java ? 'Готово к запуску' : 'Нужна Java'}
            </span>
          </header>

          <h2>Всё под контролем</h2>
          <p>Ключевые параметры лаунчера и быстрый доступ к настройкам.</p>

          <div className="system-list">
            <div className="system-row">
              <span className="system-row__icon system-row__icon--java">
                <CoffeeIcon size={16} />
              </span>
              <div>
                <small>Java</small>
                <strong>{java ? `${java.major} · ${java.version}` : 'Не найдена'}</strong>
              </div>
              <span className={`system-row__badge${java ? ' system-row__badge--ok' : ' system-row__badge--warn'}`}>
                {java ? 'OK' : '!'}
              </span>
            </div>

            <div className="system-row">
              <span className="system-row__icon system-row__icon--memory">
                <GridIcon size={16} />
              </span>
              <div>
                <small>Память</small>
                <strong>{formatMemory(settings.memoryMb)} выделено</strong>
              </div>
            </div>

            <div className="system-row">
              <span className="system-row__icon system-row__icon--folder">
                <FolderIcon size={16} />
              </span>
              <div>
                <small>Папка игры</small>
                <strong className="system-row__path" title={settings.gameDirectory}>
                  {settings.gameDirectory || '—'}
                </strong>
              </div>
            </div>

            {latestRelease ? (
              <div className="system-row">
                <span className="system-row__icon system-row__icon--release">
                  <DownloadIcon size={16} />
                </span>
                <div>
                  <small>Актуальный релиз</small>
                  <strong>
                    {latestRelease.id} · {formatDate(latestRelease.releaseTime)}
                  </strong>
                </div>
              </div>
            ) : null}
          </div>

          <div className="system-panel__actions">
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => navigate('/settings')}
            >
              <SettingsIcon size={14} />
              Настройки
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => navigate('/versions')}
            >
              <LayersIcon size={14} />
              Версии
            </button>
          </div>
        </aside>
      </div>

      <section className="home-section">
        <header className="home-section__head">
          <div>
            <span className="eyebrow">
              <SparklesIcon size={13} />
              Витрина Modrinth
            </span>
            <h2>Сборки, которые стоит попробовать</h2>
            <p>Готовые модпаки устанавливаются как отдельные инстансы со своим загрузчиком.</p>
          </div>
          <div className="home-section__actions">
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => navigate('/modpacks')}
            >
              Весь каталог
            </button>
          </div>
        </header>

        {featuredError ? (
          <div className="callout callout--error">
            <AlertIcon size={18} />
            <span>Не удалось загрузить витрину: {featuredError}</span>
          </div>
        ) : null}

        {featuredLoading ? (
          <div className="project-grid project-grid--classic">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="project-skeleton" key={index}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className="project-grid project-grid--classic">
            {featured.slice(0, 4).map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                installing={install !== null}
                onOpen={() => setSelectedProject(project)}
              />
            ))}
          </div>
        ) : !featuredError ? (
          <div className="home-empty">
            <span className="home-empty__icon">
              <CompassIcon size={24} />
            </span>
            <div>
              <strong>Витрина временно пуста</strong>
              <p>Откройте каталог и найдите сборку по версии или загрузчику.</p>
            </div>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => navigate('/modpacks')}>
              Открыть каталог
            </button>
          </div>
        ) : null}
      </section>

      <LogConsole
        logs={logs}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((value) => !value)}
        onClear={clearLogs}
        status={launch.status}
      />

      {!activeAccount ? (
        <div className="callout callout--info">
          <AlertIcon size={18} />
          <span>
            Для запуска нужен аккаунт. Microsoft-вход использует официальные сервисы Mojang, офлайн-профиль
            работает без интернета.
          </span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => navigate('/accounts')}>
            Настроить
          </button>
        </div>
      ) : null}

      <p className="page-footnote">
        Память: {formatMemory(settings.memoryMb)} · Снапшоты{' '}
        {settings.showSnapshots ? 'включены' : 'скрыты'}
        {latestRelease ? ` · Актуальный релиз ${latestRelease.id}` : ''}
      </p>

      <CreateInstanceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(instanceId) => navigate(`/instances/${instanceId}`)}
      />

      <ProjectDialog
        open={selectedProject !== null}
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
        onInstalled={(instanceId) => {
          if (instanceId) navigate(`/instances/${instanceId}`)
        }}
        onCreateInstance={() => setCreateOpen(true)}
      />
    </div>
  )
}

function launchTitle(status: string): string {
  switch (status) {
    case 'starting':
      return 'Запускаем Minecraft'
    case 'running':
      return 'Игра запущена'
    case 'stopping':
      return 'Останавливаем игру'
    case 'exited':
      return 'Игра завершилась'
    case 'error':
      return 'Ошибка запуска'
    default:
      return 'Состояние запуска'
  }
}
