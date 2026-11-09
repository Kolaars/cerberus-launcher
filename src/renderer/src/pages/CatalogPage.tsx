import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type {
  CatalogProject,
  CatalogSearchResult,
  CatalogSource,
  ContentType,
  LoaderType
} from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import {
  CATALOG_SOURCE_LABELS,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_SINGULAR,
  LOADER_LABELS
} from '../lib/format'
import { PageHeader } from '../components/Layout'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectDialog } from '../components/ProjectDialog'
import { CreateInstanceDialog } from '../components/CreateInstanceDialog'
import {
  AlertIcon,
  BoxIcon,
  ChevronRightIcon,
  CompassIcon,
  ImageIcon,
  PuzzleIcon,
  RefreshIcon,
  SearchIcon,
  WandIcon
} from '../components/Icons'

const TYPES: Array<{ value: ContentType; icon: typeof BoxIcon }> = [
  { value: 'modpack', icon: BoxIcon },
  { value: 'mod', icon: PuzzleIcon },
  { value: 'shader', icon: WandIcon },
  { value: 'resourcepack', icon: ImageIcon }
]

const LOADERS: Array<{ value: 'all' | LoaderType; label: string }> = [
  { value: 'all', label: 'Любой загрузчик' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' }
]

const PAGE_SIZE = 20

export function CatalogPage({ initialType }: { initialType?: ContentType }) {
  const {
    settings,
    instances,
    remote,
    searchCatalog,
    refreshInstances
  } = useLauncher()
  const [searchParams] = useSearchParams()

  const [type, setType] = useState<ContentType>(initialType ?? 'modpack')
  const [source, setSource] = useState<CatalogSource>('modrinth')
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [gameVersion, setGameVersion] = useState('')
  const [loader, setLoader] = useState<'all' | LoaderType>('all')
  const [sort, setSort] = useState<'relevance' | 'downloads' | 'updated' | 'newest'>('relevance')
  const [offset, setOffset] = useState(0)
  const [result, setResult] = useState<CatalogSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<CatalogProject | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [targetInstanceId, setTargetInstanceId] = useState(searchParams.get('instance') ?? '')
  const requestId = useRef(0)

  const targetInstance = useMemo(
    () => instances.find((instance) => instance.id === targetInstanceId) ?? null,
    [instances, targetInstanceId]
  )

  useEffect(() => {
    const paramType = searchParams.get('type')
    if (paramType && ['modpack', 'mod', 'shader', 'resourcepack'].includes(paramType)) {
      setType(paramType as ContentType)
      setOffset(0)
    }
    const instance = searchParams.get('instance')
    if (instance) setTargetInstanceId(instance)
  }, [searchParams])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchText.trim())
      setOffset(0)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchText])

  const curseForgeMissingKey = source === 'curseforge' && !settings.curseForgeApiKey

  useEffect(() => {
    if (curseForgeMissingKey) {
      setResult(null)
      setLoading(false)
      setError(null)
      return
    }

    const current = ++requestId.current
    setLoading(true)
    setError(null)

    void searchCatalog({
      source,
      type,
      query: query || undefined,
      gameVersion: gameVersion || undefined,
      loader: loader === 'all' ? undefined : loader,
      sort,
      offset,
      limit: PAGE_SIZE
    })
      .then((data) => {
        if (requestId.current !== current) return
        setResult(data)
      })
      .catch((reason: unknown) => {
        if (requestId.current !== current) return
        setResult(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (requestId.current === current) setLoading(false)
      })
  }, [source, type, query, gameVersion, loader, sort, offset, curseForgeMissingKey, searchCatalog])

  const gameVersions = useMemo(() => {
    const map = new Map<string, string>()
    for (const version of remote) {
      if (version.type === 'release' || settings.showSnapshots) {
        map.set(version.id, version.releaseTime)
      }
    }
    for (const instance of instances) {
      if (!map.has(instance.minecraftVersion)) {
        map.set(instance.minecraftVersion, '')
      }
    }
    return [...map.entries()]
      .sort((a, b) => {
        if (!a[1]) return 1
        if (!b[1]) return -1
        return Date.parse(b[1]) - Date.parse(a[1])
      })
      .map(([id]) => id)
  }, [remote, instances, settings.showSnapshots])

  const changeType = (next: ContentType): void => {
    setType(next)
    setOffset(0)
    setResult(null)
  }

  const changeFilter = <T,>(setter: (value: T) => void, value: T): void => {
    setter(value)
    setOffset(0)
  }

  const total = result?.total ?? 0
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasPrev = offset > 0
  const hasNext = offset + PAGE_SIZE < total

  return (
    <div className="page page--catalog">
      <PageHeader
        eyebrow="Каталог"
        title="Контент для Minecraft"
        description="Модпаки, моды, шейдеры и ресурспаки из Modrinth и CurseForge. Всё устанавливается внутрь выбранного инстанса."
        actions={
          <div className="catalog-source">
            <button
              type="button"
              className={`catalog-source__btn${source === 'modrinth' ? ' catalog-source__btn--active' : ''}`}
              onClick={() => changeFilter(setSource, 'modrinth')}
            >
              Modrinth
            </button>
            <button
              type="button"
              className={`catalog-source__btn${source === 'curseforge' ? ' catalog-source__btn--active' : ''}`}
              onClick={() => changeFilter(setSource, 'curseforge')}
            >
              CurseForge
            </button>
          </div>
        }
      />

      <div className="catalog-tabs" role="tablist" aria-label="Тип контента">
        {TYPES.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={type === entry.value}
              className={`catalog-tab${type === entry.value ? ' catalog-tab--active' : ''}`}
              onClick={() => changeType(entry.value)}
            >
              <Icon size={17} />
              {CONTENT_TYPE_LABELS[entry.value]}
            </button>
          )
        })}
      </div>

      {targetInstance && type !== 'modpack' ? (
        <div className="catalog-target">
          <span className="catalog-target__icon">
            <CompassIcon size={18} />
          </span>
          <div>
            <strong>Установка в «{targetInstance.name}»</strong>
            <small>
              Minecraft {targetInstance.minecraftVersion} · {LOADER_LABELS[targetInstance.loader]}
            </small>
          </div>
          <select
            className="input prism-select"
            value={targetInstanceId}
            onChange={(event) => setTargetInstanceId(event.target.value)}
            aria-label="Целевой инстанс"
          >
            {instances.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>
          <Link to="/catalog" className="btn btn--ghost btn--small">
            Без привязки
          </Link>
        </div>
      ) : null}

      <div className="catalog-filters">
        <label className="search-field catalog-filters__search">
          <SearchIcon size={15} />
          <input
            className="input input--search"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={`Поиск: ${CONTENT_TYPE_LABELS[type].toLowerCase()}`}
          />
        </label>

        <select
          className="input prism-select"
          value={gameVersion}
          onChange={(event) => changeFilter(setGameVersion, event.target.value)}
          aria-label="Версия Minecraft"
        >
          <option value="">Любая версия</option>
          {gameVersions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
        </select>

        <select
          className="input prism-select"
          value={loader}
          onChange={(event) => changeFilter(setLoader, event.target.value as 'all' | LoaderType)}
          aria-label="Загрузчик"
          disabled={type === 'shader' || type === 'resourcepack'}
        >
          {LOADERS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>

        <select
          className="input prism-select"
          value={sort}
          onChange={(event) =>
            changeFilter(
              setSort,
              event.target.value as 'relevance' | 'downloads' | 'updated' | 'newest'
            )
          }
          aria-label="Сортировка"
        >
          <option value="relevance">По релевантности</option>
          <option value="downloads">По загрузкам</option>
          <option value="updated">По обновлению</option>
          <option value="newest">Новые</option>
        </select>

        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setSearchText('')
            setQuery('')
            setGameVersion('')
            setLoader('all')
            setSort('relevance')
            setOffset(0)
          }}
        >
          <RefreshIcon size={14} />
          Сбросить
        </button>
      </div>

      {source === 'curseforge' && !settings.curseForgeApiKey ? (
        <div className="callout callout--info">
          <AlertIcon size={18} />
          <span>
            CurseForge требует API-ключ. Добавьте его в настройках — ключ хранится локально
            в файле настроек лаунчера.
          </span>
          <Link to="/settings" className="btn btn--secondary btn--small">
            Открыть настройки
          </Link>
        </div>
      ) : null}

      <div className="catalog-meta">
        <span>
          {loading
            ? 'Ищем проекты…'
            : result
              ? `${total.toLocaleString('ru-RU')} проектов · страница ${page} из ${pages}`
              : 'Готово к поиску'}
        </span>
        <span className="catalog-meta__source">
          {CATALOG_SOURCE_LABELS[source]} · {CONTENT_TYPE_SINGULAR[type]}
        </span>
      </div>

      {error ? (
        <div className="callout callout--error">
          <AlertIcon size={18} />
          <span>{error}</span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => setOffset((current) => current)}
          >
            Повторить
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="project-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="project-skeleton" key={index}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : result && result.projects.length > 0 ? (
        <div className="project-grid">
          {result.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => setSelectedProject(project)}
            />
          ))}
        </div>
      ) : error ? null : (
        <div className="prism-empty">
          <span className="prism-empty__icon">
            <SearchIcon size={26} />
          </span>
          <h3>Ничего не найдено</h3>
          <p>Попробуйте другой запрос, версию Minecraft или источник каталога.</p>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              setSearchText('')
              setQuery('')
              setGameVersion('')
              setLoader('all')
              setSort('relevance')
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="catalog-pagination">
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={!hasPrev || loading}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            Назад
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={!hasNext || loading}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Дальше
            <ChevronRightIcon size={14} />
          </button>
        </div>
      ) : null}

      <div className="catalog-note">
        <AlertIcon size={16} />
        <span>
          Устанавливайте моды в инстансы с подходящим загрузчиком. Для шейдеров также
          понадобится Iris или OptiFine внутри сборки.
        </span>
      </div>

      <ProjectDialog
        open={selectedProject !== null}
        project={selectedProject}
        defaultInstanceId={targetInstance?.id}
        onClose={() => setSelectedProject(null)}
        onInstalled={async (instanceId) => {
          await refreshInstances()
          if (instanceId) setTargetInstanceId(instanceId)
        }}
        onCreateInstance={() => setCreateOpen(true)}
      />

      <CreateInstanceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(instanceId) => {
          setTargetInstanceId(instanceId)
          void refreshInstances()
        }}
      />
    </div>
  )
}
