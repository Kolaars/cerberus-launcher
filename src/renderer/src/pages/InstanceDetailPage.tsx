import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ContentType, InstanceContent } from '@shared/types'
import type { InstancePathTarget } from '@shared/ipc'
import { useLauncher } from '../context/LauncherContext'
import {
  ArrowLeftIcon,
  BoxIcon,
  ClockIcon,
  DownloadIcon,
  FolderIcon,
  ImageIcon,
  LayersIcon,
  PlayIcon,
  PlusIcon,
  PuzzleIcon,
  StopIcon,
  TrashIcon,
  WandIcon
} from '../components/Icons'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { LogConsole } from '../components/LogConsole'
import { ProgressBar } from '../components/ProgressBar'
import {
  CONTENT_TYPE_SINGULAR,
  LOADER_LABELS,
  STAGE_LABELS,
  formatDate,
  formatPlaytime,
  formatRelativeDate,
  instanceInitial,
  plural
} from '../lib/format'

type ContentTab = 'mod' | 'resourcepack' | 'shader'

const TABS: Array<{ value: ContentTab; label: string; icon: typeof BoxIcon }> = [
  { value: 'mod', label: 'Моды', icon: PuzzleIcon },
  { value: 'resourcepack', label: 'Ресурспаки', icon: ImageIcon },
  { value: 'shader', label: 'Шейдеры', icon: WandIcon }
]

const ACTIVE_STATUSES = ['starting', 'running', 'stopping']

export function InstanceDetailPage() {
  const navigate = useNavigate()
  const { instanceId = '' } = useParams<{ instanceId: string }>()
  const {
    instances,
    activeAccount,
    install,
    cancelInstall,
    launch,
    logs,
    clearLogs,
    launchInstance,
    stopGame,
    openInstancePath,
    listInstanceContent,
    removeInstanceContent,
    deleteInstance,
    refreshInstances
  } = useLauncher()

  const instance = useMemo(
    () => instances.find((entry) => entry.id === instanceId) ?? null,
    [instances, instanceId]
  )

  const [tab, setTab] = useState<ContentTab>('mod')
  const [content, setContent] = useState<InstanceContent[]>([])
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<InstanceContent | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)

  const loadContent = useCallback(async (): Promise<void> => {
    if (!instanceId) return
    setContentLoading(true)
    setContentError(null)
    try {
      setContent(await listInstanceContent(instanceId))
    } catch (error) {
      setContentError(error instanceof Error ? error.message : String(error))
    } finally {
      setContentLoading(false)
    }
  }, [instanceId, listInstanceContent])

  useEffect(() => {
    if (!instance) return
    void loadContent()
  }, [loadContent, instance?.contentCount])

  useEffect(() => {
    setTab('mod')
  }, [instanceId])

  const running = ACTIVE_STATUSES.includes(launch.status) && launch.instanceId === instanceId
  const otherRunning = ACTIVE_STATUSES.includes(launch.status) && launch.instanceId !== instanceId
  const installingHere = install?.instanceId === instanceId
  const anyInstall = install !== null

  const filtered = content.filter((entry) => entry.projectType === tab)

  const counts = useMemo(() => {
    const map: Record<ContentTab, number> = { mod: 0, resourcepack: 0, shader: 0 }
    for (const entry of content) map[entry.projectType] += 1
    return map
  }, [content])

  const play = async (): Promise<void> => {
    if (!instance) return
    if (!activeAccount) {
      navigate('/accounts')
      return
    }
    await launchInstance(instance.id)
  }

  const openFolder = (target: InstancePathTarget): void => {
    if (instance) void openInstancePath(instance.id, target)
  }

  const handleRemove = async (): Promise<void> => {
    if (!removeTarget) return
    const target = removeTarget
    setRemoveTarget(null)
    const ok = await removeInstanceContent(instanceId, target.id)
    if (ok) await loadContent()
  }

  const handleDelete = async (): Promise<void> => {
    setDeleteOpen(false)
    const ok = await deleteInstance(instanceId)
    if (ok) {
      await refreshInstances()
      navigate('/')
    }
  }

  if (!instance) {
    return (
      <div className="page page--instance">
        <div className="prism-empty">
          <span className="prism-empty__icon">
            <BoxIcon size={28} />
          </span>
          <h3>Инстанс не найден</h3>
          <p>Возможно, он был удалён. Вернитесь на главную и выберите другую сборку.</p>
          <Link to="/" className="btn btn--primary">
            <ArrowLeftIcon size={16} />
            На главную
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page page--instance">
      <nav className="instance-breadcrumb" aria-label="Навигация">
        <Link to="/" className="instance-breadcrumb__link">
          <ArrowLeftIcon size={14} />
          Инстансы
        </Link>
        <span className="instance-breadcrumb__sep">/</span>
        <span>{instance.name}</span>
      </nav>

      <header className="instance-hero">
        <div className="instance-hero__glow" aria-hidden="true" />
        <div className="instance-hero__identity">
          <span className={`instance-icon instance-icon--large${instance.iconUrl ? ' instance-icon--image' : ''}`}>
            {instance.iconUrl ? (
              <img src={instance.iconUrl} alt="" loading="lazy" />
            ) : (
              <span>{instanceInitial(instance.name)}</span>
            )}
          </span>
          <div className="instance-hero__copy">
            <div className="instance-hero__title">
              <h1>{instance.name}</h1>
              <span className={`loader-badge loader-badge--${instance.loader}`}>
                {LOADER_LABELS[instance.loader]}
              </span>
              {running ? <span className="badge badge--success">Запущен</span> : null}
            </div>
            <p>
              {instance.description ||
                `Minecraft ${instance.minecraftVersion} с загрузчиком ${LOADER_LABELS[instance.loader]} и изолированным набором контента.`}
            </p>
            <div className="instance-hero__meta">
              <span className="instance-meta-chip">
                <LayersIcon size={14} />
                Minecraft {instance.minecraftVersion}
              </span>
              <span className="instance-meta-chip">
                <BoxIcon size={14} />
                {LOADER_LABELS[instance.loader]}
                {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
              </span>
              <span className="instance-meta-chip">
                <DownloadIcon size={14} />
                {plural(instance.contentCount, 'файл', 'файла', 'файлов')}
              </span>
              <span className="instance-meta-chip">
                <ClockIcon size={14} />
                {formatPlaytime(instance.playtimeSeconds)}
              </span>
            </div>
          </div>
        </div>

        <div className="instance-hero__actions">
          <button
            type="button"
            className={`btn btn--hero ${running ? 'btn--secondary' : 'btn--primary'}`}
            onClick={() => (running ? void stopGame() : void play())}
            disabled={installingHere || otherRunning}
            title={otherRunning ? 'Сначала остановите другую игру' : undefined}
          >
            {running ? <StopIcon size={18} /> : <PlayIcon size={18} />}
            {running ? 'Остановить' : 'Играть'}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => openFolder('mods')}
            disabled={instance.loader === 'vanilla'}
            title={instance.loader === 'vanilla' ? 'В vanilla-инстансе нет модов' : undefined}
          >
            <FolderIcon size={16} />
            Папка mods
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => openFolder('root')}
          >
            <FolderIcon size={16} />
            Открыть инстанс
          </button>
          <button
            type="button"
            className="icon-button icon-button--danger"
            onClick={() => setDeleteOpen(true)}
            disabled={running || otherRunning || anyInstall}
            aria-label="Удалить инстанс"
            title="Удалить инстанс"
          >
            <TrashIcon size={17} />
          </button>
        </div>

        <div className="instance-hero__footer">
          <span>
            Создан {formatDate(new Date(instance.createdAt).toISOString())}
          </span>
          <span className="instance-card__dot" />
          <span>
            {instance.lastPlayedAt
              ? `Последний запуск ${formatRelativeDate(instance.lastPlayedAt)}`
              : 'Ещё не запускался'}
          </span>
          {instance.source !== 'manual' ? (
            <>
              <span className="instance-card__dot" />
              <span>
                Импортирован из {instance.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
              </span>
            </>
          ) : null}
        </div>
      </header>

      {installingHere && install ? (
        <section className="panel install-panel">
          <div className="panel__head">
            <div>
              <span className="eyebrow">{install.label ?? 'Установка'}</span>
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

      <section className="panel instance-content-panel">
        <div className="instance-tabs" role="tablist" aria-label="Контент инстанса">
          {TABS.map((entry) => {
            const Icon = entry.icon
            return (
              <button
                key={entry.value}
                type="button"
                role="tab"
                aria-selected={tab === entry.value}
                className={`instance-tab${tab === entry.value ? ' instance-tab--active' : ''}`}
                onClick={() => setTab(entry.value)}
              >
                <Icon size={16} />
                <span>{entry.label}</span>
                <span className="instance-tab__count">{counts[entry.value]}</span>
              </button>
            )
          })}

          <div className="instance-tabs__spacer" />

          <Link
            to={`/catalog?type=${tab}&instance=${instance.id}`}
            className="btn btn--primary btn--small"
          >
            <PlusIcon size={15} />
            Добавить
          </Link>
        </div>

        {contentError ? (
          <div className="callout callout--error">
            <span>{contentError}</span>
            <button type="button" className="btn btn--secondary btn--small" onClick={() => void loadContent()}>
              Повторить
            </button>
          </div>
        ) : null}

        {contentLoading && content.length === 0 ? (
          <div className="content-loading">
            <span className="spinner" />
            Читаем содержимое инстанса…
          </div>
        ) : filtered.length === 0 ? (
          <div className="content-empty">
            <span className="content-empty__icon">{iconForTab(tab)}</span>
            <h3>{emptyTitle(tab)}</h3>
            <p>{emptyDescription(tab, instance.loader)}</p>
            <Link
              to={`/catalog?type=${tab}&instance=${instance.id}`}
              className="btn btn--secondary btn--small"
            >
              <DownloadIcon size={15} />
              Открыть каталог
            </Link>
          </div>
        ) : (
          <div className="content-list">
            {filtered.map((entry) => (
              <article className="content-row" key={entry.id}>
                <span className={`content-row__icon${entry.iconUrl ? ' content-row__icon--image' : ''}`}>
                  {entry.iconUrl ? <img src={entry.iconUrl} alt="" loading="lazy" /> : iconForTab(tab)}
                </span>
                <div className="content-row__main">
                  <strong>{entry.name}</strong>
                  <small>
                    {entry.fileName} · {CONTENT_TYPE_SINGULAR[entry.projectType]} {entry.versionNumber}
                  </small>
                </div>
                <span className={`source-badge source-badge--${entry.source}`}>
                  {entry.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                </span>
                <span className="content-row__date">{formatDate(new Date(entry.installedAt).toISOString())}</span>
                <button
                  type="button"
                  className="icon-button icon-button--danger"
                  onClick={() => setRemoveTarget(entry)}
                  disabled={running || anyInstall}
                  aria-label={`Удалить ${entry.name}`}
                  title="Удалить файл"
                >
                  <TrashIcon size={16} />
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel instance-paths">
        <div className="panel__head">
          <div>
            <span className="eyebrow">Файлы</span>
            <h3>Папки инстанса</h3>
          </div>
        </div>
        <div className="instance-paths__grid">
          {(
            [
              { target: 'minecraft', label: 'Minecraft', hint: 'Корень игры, конфиги и сохранения' },
              { target: 'mods', label: 'mods', hint: 'Моды загрузчика' },
              { target: 'resourcepacks', label: 'resourcepacks', hint: 'Наборы ресурсов' },
              { target: 'shaderpacks', label: 'shaderpacks', hint: 'Шейдеры' },
              { target: 'saves', label: 'saves', hint: 'Миры' }
            ] as Array<{ target: InstancePathTarget; label: string; hint: string }>
          ).map((entry) => (
            <button
              key={entry.target}
              type="button"
              className="instance-path"
              onClick={() => openFolder(entry.target)}
            >
              <FolderIcon size={18} />
              <span>
                <strong>{entry.label}</strong>
                <small>{entry.hint}</small>
              </span>
            </button>
          ))}
        </div>
      </section>

      <LogConsole
        logs={logs}
        open={consoleOpen}
        onToggle={() => setConsoleOpen((value) => !value)}
        onClear={clearLogs}
        status={launch.status}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        title="Удалить файл контента?"
        description={
          removeTarget
            ? `${removeTarget.name} (${removeTarget.fileName}) будет удалён из инстанса «${instance.name}».`
            : ''
        }
        confirmLabel="Удалить"
        danger
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemove()}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Удалить инстанс?"
        description={`Инстанс «${instance.name}» будет удалён вместе со всей папкой minecraft: модами, ресурспаками, шейдерами и сохранениями. Общие библиотеки и assets останутся.`}
        confirmLabel="Удалить инстанс"
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}

function iconForTab(tab: ContentType | ContentTab) {
  switch (tab) {
    case 'resourcepack':
      return <ImageIcon size={20} />
    case 'shader':
      return <WandIcon size={20} />
    default:
      return <PuzzleIcon size={20} />
  }
}

function emptyTitle(tab: ContentTab): string {
  switch (tab) {
    case 'resourcepack':
      return 'Ресурспаки не установлены'
    case 'shader':
      return 'Шейдеры не установлены'
    default:
      return 'Модов пока нет'
  }
}

function emptyDescription(tab: ContentTab, loader: string): string {
  if (tab === 'mod' && loader === 'vanilla') {
    return 'Vanilla-инстанс не поддерживает моды. Создайте сборку с Fabric, Quilt, Forge или NeoForge.'
  }
  switch (tab) {
    case 'resourcepack':
      return 'Найдите ресурспак в каталоге и установите его прямо в этот инстанс.'
    case 'shader':
      return 'Шейдеры устанавливаются в папку shaderpacks. Для их работы нужен Iris или OptiFine.'
    default:
      return 'Откройте каталог Modrinth или CurseForge и добавьте моды, совместимые с версией и загрузчиком.'
  }
}
