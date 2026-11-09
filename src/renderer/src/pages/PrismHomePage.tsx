import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CatalogProject, CatalogSource, Instance, LoaderType } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import { formatMemory, formatPlaytime, plural, pluralWord, STAGE_LABELS } from '../lib/format'
import { InstanceCard } from '../components/InstanceCard'
import { ProjectCard } from '../components/ProjectCard'
import { ProjectDialog } from '../components/ProjectDialog'
import { CreateInstanceDialog } from '../components/CreateInstanceDialog'
import { ProgressBar } from '../components/ProgressBar'
import { LogoMark } from '../components/Logo'
import {
  AlertIcon,
  BoxIcon,
  CompassIcon,
  CoffeeIcon,
  DownloadIcon,
  GridIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon
} from '../components/Icons'

const LOADER_FILTERS: Array<{ value: 'all' | LoaderType; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' }
]

type SortMode = 'recent' | 'name' | 'playtime'

export function PrismHomePage() {
  const navigate = useNavigate()
  const {
    instances,
    activeAccount,
    settings,
    java,
    install,
    cancelInstall,
    launch,
    launchInstance,
    stopGame,
    openInstancePath,
    featuredModpacks,
    searchCatalog
  } = useLauncher()

  const [query, setQuery] = useState('')
  const [loaderFilter, setLoaderFilter] = useState<'all' | LoaderType>('all')
  const [sort, setSort] = useState<SortMode>('recent')
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<CatalogProject | null>(null)
  const [modpackSource, setModpackSource] = useState<CatalogSource>('modrinth')
  const [featured, setFeatured] = useState<CatalogProject[]>([])
  const [featuredLoading, setFeaturedLoading] = useState(false)
  const [featuredError, setFeaturedError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setFeaturedLoading(true)
    setFeaturedError(null)

    const request =
      modpackSource === 'modrinth'
        ? featuredModpacks()
        : searchCatalog({
            source: 'curseforge',
            type: 'modpack',
            sort: 'downloads',
            limit: 8,
            offset: 0
          }).then((result) => result.projects)

    void request
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
  }, [modpackSource, featuredModpacks, searchCatalog])

  const filteredInstances = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const list = instances.filter((instance) => {
      if (loaderFilter !== 'all' && instance.loader !== loaderFilter) return false
      if (!normalized) return true
      return (
        instance.name.toLowerCase().includes(normalized) ||
        instance.description.toLowerCase().includes(normalized) ||
        instance.minecraftVersion.toLowerCase().includes(normalized)
      )
    })

    return list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'ru')
      if (sort === 'playtime') return b.playtimeSeconds - a.playtimeSeconds
      return (b.lastPlayedAt ?? b.createdAt) - (a.lastPlayedAt ?? a.createdAt)
    })
  }, [instances, query, loaderFilter, sort])

  const totalContent = instances.reduce((sum, instance) => sum + instance.contentCount, 0)
  const running = ['starting', 'running', 'stopping'].includes(launch.status)

  const play = async (instance: Instance): Promise<void> => {
    if (!activeAccount) {
      navigate('/accounts')
      return
    }
    await launchInstance(instance.id)
  }

  return (
    <div className="page page--prism">
      <section className="prism-hero">
        <div className="prism-hero__glow" aria-hidden="true" />
        <div className="prism-hero__grid" aria-hidden="true" />
        <div className="prism-hero__copy">
          <span className="eyebrow">
            <SparklesIcon size={13} />
            Prism-режим · {plural(instances.length, 'инстанс', 'инстанса', 'инстансов')}
          </span>
          <h1>
            Твои миры.
            <br />
            <span>Твои правила.</span>
          </h1>
          <p>
            Изолированные сборки с модами, шейдерами и ресурспаками. Создавай инстансы,
            устанавливай контент из Modrinth и CurseForge и запускай всё в один клик.
          </p>

          <div className="prism-hero__actions">
            <button type="button" className="btn btn--primary btn--hero" onClick={() => setCreateOpen(true)}>
              <PlusIcon size={19} />
              Создать инстанс
            </button>
            <Link to="/catalog" className="btn btn--secondary btn--hero">
              <CompassIcon size={19} />
              Открыть каталог
            </Link>
          </div>

          <div className="prism-hero__account">
            <span className={`status-dot${activeAccount ? '' : ' status-dot--warning'}`} />
            <span>
              {activeAccount ? (
                <>
                  Играем как <strong>{activeAccount.username}</strong>
                  {java ? ` · Java ${java.major}` : ' · Java не найдена'}
                </>
              ) : (
                <>
                  Аккаунт не выбран.{' '}
                  <Link to="/accounts" className="link-inline">
                    Войти
                  </Link>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="prism-hero__art" aria-hidden="true">
          <div className="prism-orbit prism-orbit--one" />
          <div className="prism-orbit prism-orbit--two" />
          <div className="prism-hero__tile prism-hero__tile--mods">
            <BoxIcon size={18} />
            <span>{totalContent}</span>
            <small>{pluralWord(totalContent, 'файл', 'файла', 'файлов')}</small>
          </div>
          <div className="prism-hero__tile prism-hero__tile--instances">
            <GridIcon size={18} />
            <span>{instances.length}</span>
            <small>{pluralWord(instances.length, 'сборка', 'сборки', 'сборок')}</small>
          </div>
          <div className="prism-hero__tile prism-hero__tile--memory">
            <CoffeeIcon size={18} />
            <span>{formatMemory(settings.memoryMb)}</span>
            <small>памяти</small>
          </div>
          <div className="prism-hero__core">
            <LogoMark size={72} />
          </div>
        </div>
      </section>

      {install ? (
        <section className="panel install-panel">
          <div className="panel__head">
            <div>
              <span className="eyebrow">
                {install.kind === 'modpack'
                  ? 'Установка сборки'
                  : install.kind === 'instance'
                    ? 'Создание инстанса'
                    : install.kind === 'content'
                      ? 'Установка контента'
                      : 'Установка'}{' '}
                {install.label ? `· ${install.label}` : install.versionId ? `· ${install.versionId}` : ''}
              </span>
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

      <section className="prism-section">
        <header className="prism-section__head">
          <div>
            <span className="eyebrow">Инстансы</span>
            <h2>Мои сборки</h2>
            <p>Каждый инстанс — отдельный minecraft-каталог со своим контентом.</p>
          </div>
          <div className="prism-toolbar">
            <label className="search-field">
              <SearchIcon size={15} />
              <input
                className="input input--search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по инстансам"
              />
            </label>
            <select
              className="input prism-select"
              value={loaderFilter}
              onChange={(event) => setLoaderFilter(event.target.value as 'all' | LoaderType)}
              aria-label="Фильтр по загрузчику"
            >
              {LOADER_FILTERS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </select>
            <select
              className="input prism-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label="Сортировка инстансов"
            >
              <option value="recent">Недавние</option>
              <option value="name">По имени</option>
              <option value="playtime">По времени</option>
            </select>
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={() => setCreateOpen(true)}
            >
              <PlusIcon size={15} />
              Создать
            </button>
          </div>
        </header>

        {instances.length === 0 ? (
          <div className="prism-empty">
            <span className="prism-empty__icon">
              <BoxIcon size={28} />
            </span>
            <h3>Пока ни одной сборки</h3>
            <p>
              Создайте первый инстанс: выберите версию Minecraft и загрузчик, а затем
              добавьте моды, шейдеры или ресурспаки из каталога.
            </p>
            <div className="prism-empty__actions">
              <button type="button" className="btn btn--primary" onClick={() => setCreateOpen(true)}>
                <PlusIcon size={16} />
                Создать инстанс
              </button>
              <Link to="/catalog" className="btn btn--secondary">
                <DownloadIcon size={16} />
                Готовые сборки
              </Link>
            </div>
          </div>
        ) : filteredInstances.length === 0 ? (
          <div className="prism-empty prism-empty--compact">
            <span className="prism-empty__icon">
              <SearchIcon size={24} />
            </span>
            <h3>Ничего не найдено</h3>
            <p>Измените поисковый запрос или фильтр загрузчика.</p>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => {
                setQuery('')
                setLoaderFilter('all')
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
          <div className="instance-grid">
            {filteredInstances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instance={instance}
                launch={launch}
                busy={install !== null || running}
                onPlay={() => void play(instance)}
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

      <section className="prism-section prism-section--modpacks">
        <header className="prism-section__head">
          <div>
            <span className="eyebrow">Витрина</span>
            <h2>Сборки, которые стоит попробовать</h2>
            <p>Популярные модпаки устанавливаются как готовые инстансы.</p>
          </div>
          <div className="prism-toolbar">
            <div className="source-switch">
              <button
                type="button"
                className={`source-switch__btn${modpackSource === 'modrinth' ? ' source-switch__btn--active' : ''}`}
                onClick={() => setModpackSource('modrinth')}
              >
                Modrinth
              </button>
              <button
                type="button"
                className={`source-switch__btn${modpackSource === 'curseforge' ? ' source-switch__btn--active' : ''}`}
                onClick={() => setModpackSource('curseforge')}
              >
                CurseForge
              </button>
            </div>
            <Link to="/catalog" className="btn btn--ghost btn--small">
              Весь каталог
            </Link>
          </div>
        </header>

        {modpackSource === 'curseforge' && !settings.curseForgeApiKey ? (
          <div className="callout callout--info">
            <AlertIcon size={18} />
            <span>Для витрины CurseForge укажите API-ключ в настройках.</span>
            <Link to="/settings" className="btn btn--secondary btn--small">
              Настроить
            </Link>
          </div>
        ) : null}

        {featuredError ? (
          <div className="callout callout--error">
            <AlertIcon size={18} />
            <span>{featuredError}</span>
          </div>
        ) : null}

        {featuredLoading ? (
          <div className="project-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="project-skeleton" key={index}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : featured.length > 0 ? (
          <div className="project-grid project-grid--prism">
            {featured.slice(0, 8).map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                installing={install !== null}
                onOpen={() => setSelectedProject(project)}
              />
            ))}
          </div>
        ) : !featuredLoading && !featuredError ? (
          <div className="prism-empty prism-empty--compact">
            <span className="prism-empty__icon">
              <BoxIcon size={24} />
            </span>
            <h3>Витрина пуста</h3>
            <p>Откройте каталог и найдите сборку по вкусу.</p>
          </div>
        ) : null}
      </section>

      <footer className="prism-footnote">
        <span>Cerberus Prism</span>
        <span>{activeAccount ? `Аккаунт: ${activeAccount.username}` : 'Аккаунт не выбран'}</span>
        <span>{plural(instances.length, 'инстанс', 'инстанса', 'инстансов')} · {formatPlaytime(instances.reduce((sum, instance) => sum + instance.playtimeSeconds, 0))}</span>
      </footer>

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
