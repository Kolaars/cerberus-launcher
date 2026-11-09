import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useLauncher } from '../context/LauncherContext'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  AlertIcon,
  DownloadIcon,
  LayersIcon,
  PlayIcon,
  RefreshIcon,
  TrashIcon
} from '../components/Icons'
import { EmptyState, PageHeader } from '../components/Layout'
import { ProgressBar } from '../components/ProgressBar'
import { STAGE_LABELS, formatDate, versionTypeLabel } from '../lib/format'

type Filter = 'all' | 'release' | 'snapshot' | 'installed'

interface VersionRow {
  id: string
  type: string
  releaseTime: string
  installed: boolean
}

const PAGE_SIZE = 120

export function VersionsPage() {
  const {
    settings,
    remote,
    remoteLoading,
    remoteError,
    installed,
    install,
    installVersion,
    cancelInstall,
    launch,
    launchVersion,
    deleteVersion,
    refreshRemoteVersions
  } = useLauncher()

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const deferredSearch = useDeferredValue(search)

  const rows = useMemo<VersionRow[]>(() => {
    const map = new Map<string, VersionRow>()

    for (const version of remote) {
      map.set(version.id, {
        id: version.id,
        type: version.type,
        releaseTime: version.releaseTime,
        installed: false
      })
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

    let result = [...map.values()]
    if (filter === 'installed') result = result.filter((row) => row.installed)
    else if (filter === 'release' || filter === 'snapshot') {
      result = result.filter((row) => row.type === filter)
    }

    const query = deferredSearch.trim().toLowerCase()
    if (query) result = result.filter((row) => row.id.toLowerCase().includes(query))

    result.sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime))
    return result
  }, [remote, installed, filter, deferredSearch])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [filter, deferredSearch])

  const visibleRows = rows.slice(0, visibleCount)
  const launchActive = ['starting', 'running', 'stopping'].includes(launch.status)
  const filters: Array<{ value: Filter; label: string }> = [
    { value: 'all', label: 'Все' },
    { value: 'release', label: 'Релизы' },
    { value: 'snapshot', label: 'Снапшоты' },
    { value: 'installed', label: 'Установленные' }
  ]

  return (
    <div className="page">
      <PageHeader
        eyebrow="Версии"
        title="Библиотека Minecraft"
        description="Установка vanilla-версий, запуск и управление локальными копиями."
        actions={
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => void refreshRemoteVersions(true)}
            disabled={remoteLoading}
          >
            <RefreshIcon size={16} className={remoteLoading ? 'spin' : undefined} />
            {remoteLoading ? 'Обновляем…' : 'Обновить список'}
          </button>
        }
      />

      {install ? (
        <div className="inline-progress">
          <div className="inline-progress__text">
            <strong>{install.versionId}</strong>
            <span>{STAGE_LABELS[install.stage]} · {install.message}</span>
          </div>
          <ProgressBar percent={install.percent} label="Прогресс установки" />
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void cancelInstall()}>
            Отменить
          </button>
        </div>
      ) : null}

      {remoteError ? (
        <div className="callout callout--error">
          <AlertIcon size={18} />
          <span>Не удалось загрузить список версий: {remoteError}</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => void refreshRemoteVersions(true)}>
            Повторить
          </button>
        </div>
      ) : null}

      <div className="toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Фильтр версий">
          {filters.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={filter === item.value}
              className={`filter-tab${filter === item.value ? ' filter-tab--active' : ''}`}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <input
          className="input input--search"
          type="search"
          placeholder="Поиск по версии…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Поиск версии"
        />
      </div>

      {filter === 'snapshot' && !settings.showSnapshots ? (
        <div className="callout callout--info">
          <AlertIcon size={18} />
          <span>Снапшоты скрыты. Включите их в настройках, чтобы увидеть полный список.</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<LayersIcon size={28} />}
          title={search ? 'Ничего не найдено' : 'Список пуст'}
          description={
            search
              ? 'Попробуйте изменить запрос или сбросить фильтр.'
              : 'Обновите список версий или измените фильтр.'
          }
          action={
            <button type="button" className="btn btn--secondary" onClick={() => void refreshRemoteVersions(true)}>
              <RefreshIcon size={16} />
              Обновить
            </button>
          }
        />
      ) : (
        <>
          <div className="version-table" role="table" aria-label="Версии Minecraft">
            <div className="version-table__head" role="row">
              <span>Версия</span>
              <span>Тип</span>
              <span>Дата релиза</span>
              <span>Статус</span>
              <span />
            </div>

            {visibleRows.map((row) => {
              const installingThis = install?.versionId === row.id
              const anyInstall = install !== null
              const actionsLocked = anyInstall || launchActive

              return (
                <div className="version-row" role="row" key={row.id}>
                  <div className="version-row__id">
                    <span className={`version-row__mark${row.installed ? ' version-row__mark--installed' : ''}`}>
                      {row.installed ? <LayersIcon size={16} /> : <DownloadIcon size={16} />}
                    </span>
                    <div>
                      <strong>{row.id}</strong>
                      <small>{row.installed ? 'Локальная копия' : 'Загружается с Mojang'}</small>
                    </div>
                  </div>

                  <span>
                    <span className={`badge badge--${row.type === 'release' ? 'success' : 'warning'}`}>
                      {versionTypeLabel(row.type)}
                    </span>
                  </span>

                  <span className="version-row__date">{formatDate(row.releaseTime)}</span>

                  <span>
                    {row.installed ? (
                      <span className="badge badge--success">Установлена</span>
                    ) : (
                      <span className="badge">Не установлена</span>
                    )}
                  </span>

                  <div className="version-row__actions">
                    {row.installed ? (
                      <>
                        <button
                          type="button"
                          className="btn btn--secondary btn--small"
                          onClick={() => void launchVersion(row.id)}
                          disabled={actionsLocked}
                        >
                          <PlayIcon size={15} />
                          Играть
                        </button>
                        <button
                          type="button"
                          className="icon-button icon-button--danger"
                          onClick={() => setDeleteTarget(row.id)}
                          aria-label={`Удалить версию ${row.id}`}
                          title="Удалить версию"
                          disabled={actionsLocked}
                        >
                          <TrashIcon size={17} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--primary btn--small"
                        onClick={() => void installVersion(row.id)}
                        disabled={actionsLocked}
                      >
                        {installingThis ? (
                          <span className="spinner spinner--small" />
                        ) : (
                          <DownloadIcon size={15} />
                        )}
                        {installingThis ? 'Установка…' : 'Установить'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="list-footer">
            <span>
              Показано {visibleRows.length} из {rows.length}
            </span>
            {visibleRows.length < rows.length ? (
              <button
                type="button"
                className="btn btn--secondary btn--small"
                onClick={() => setVisibleCount((value) => value + PAGE_SIZE)}
              >
                Показать ещё
              </button>
            ) : null}
          </div>
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить версию?"
        description={
          deleteTarget
            ? `Версия ${deleteTarget} будет удалена вместе с клиентом и нативами. Общие библиотеки и ресурсы останутся на диске.`
            : ''
        }
        confirmLabel="Удалить"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteVersion(deleteTarget)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
