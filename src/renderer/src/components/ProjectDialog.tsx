import { useEffect, useMemo, useState } from 'react'
import type { CatalogProject, CatalogVersion, Instance } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import {
  formatBytes,
  formatDate,
  formatDownloads,
  LOADER_LABELS,
  STAGE_LABELS
} from '../lib/format'
import { Modal } from './Modal'
import { ProgressBar } from './ProgressBar'
import {
  AlertIcon,
  CheckIcon,
  DownloadIcon,
  ExternalIcon,
  PlusIcon
} from './Icons'

export function ProjectDialog({
  open,
  project,
  defaultInstanceId,
  onClose,
  onInstalled,
  onCreateInstance
}: {
  open: boolean
  project: CatalogProject | null
  defaultInstanceId?: string
  onClose: () => void
  onInstalled?: (instanceId?: string) => void
  onCreateInstance?: () => void
}) {
  const {
    instances,
    install,
    cancelInstall,
    listCatalogVersions,
    installModpack,
    installContent,
    openExternal
  } = useLauncher()

  const [versions, setVersions] = useState<CatalogVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const targetInstance = useMemo(
    () => instances.find((instance) => instance.id === instanceId) ?? null,
    [instances, instanceId]
  )

  const contentMode = project !== null && project.projectType !== 'modpack'
  const needsLoader = project?.projectType === 'mod'

  useEffect(() => {
    if (!open) return
    const preferred =
      instances.find((instance) => instance.id === defaultInstanceId) ??
      instances.find((instance) => (needsLoader ? instance.loader !== 'vanilla' : true)) ??
      instances[0] ??
      null
    setInstanceId(preferred?.id ?? '')
    setShowAll(false)
    setFormError(null)
    setSelectedVersionId('')
    setVersions([])
    setVersionsError(null)
  }, [open, defaultInstanceId, needsLoader])

  useEffect(() => {
    if (!open || !project) return
    let cancelled = false
    setLoading(true)
    setVersionsError(null)
    setVersions([])

    const gameVersion =
      !showAll && contentMode && targetInstance
        ? targetInstance.minecraftVersion
        : undefined
    const loader =
      !showAll && needsLoader && targetInstance ? targetInstance.loader : undefined

    void listCatalogVersions(
      project.source,
      project.projectId,
      project.projectType,
      gameVersion,
      loader
    )
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        setSelectedVersionId((current) =>
          list.some((version) => version.id === current) ? current : (list[0]?.id ?? '')
        )
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setVersionsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    open,
    project,
    contentMode,
    needsLoader,
    targetInstance?.id,
    targetInstance?.minecraftVersion,
    targetInstance?.loader,
    showAll,
    listCatalogVersions
  ])

  const visibleVersions = useMemo(() => {
    if (!project) return []
    const list =
      showAll || !targetInstance || project.projectType === 'modpack'
        ? versions
        : versions.filter((version) => {
            if (
              version.gameVersions.length > 0 &&
              !version.gameVersions.includes(targetInstance.minecraftVersion)
            ) {
              return false
            }
            if (
              project.projectType === 'mod' &&
              version.loaders.length > 0 &&
              !version.loaders.includes(targetInstance.loader)
            ) {
              return false
            }
            return true
          })
    return list.slice(0, 120)
  }, [versions, showAll, targetInstance, project])

  if (!project) return null

  const selectedVersion =
    visibleVersions.find((version) => version.id === selectedVersionId) ?? null
  const selectedCompatible = isCompatible(project, selectedVersion, targetInstance)

  const handleInstall = async (): Promise<void> => {
    if (!selectedVersion) {
      setFormError('Выберите версию файла.')
      return
    }
    if (project.projectType === 'modpack') {
      setFormError(null)
      setInstalling(true)
      const result = await installModpack({
        source: project.source,
        projectId: project.projectId,
        versionId: selectedVersion.id,
        projectVersionName: selectedVersion.versionNumber
      })
      setInstalling(false)
      if (result?.instanceId) {
        onClose()
        onInstalled?.(result.instanceId)
      }
      return
    }

    if (!targetInstance) {
      setFormError('Выберите инстанс для установки.')
      return
    }
    if (project.projectType === 'mod' && targetInstance.loader === 'vanilla') {
      setFormError('Для модов нужен инстанс с Fabric, Quilt, Forge или NeoForge.')
      return
    }

    setFormError(null)
    setInstalling(true)
    const result = await installContent({
      source: project.source,
      projectId: project.projectId,
      versionId: selectedVersion.id,
      instanceId: targetInstance.id,
      projectType: project.projectType,
      versionNumber: selectedVersion.versionNumber,
      name: project.name,
      iconUrl: project.iconUrl
    })
    setInstalling(false)
    if (result) {
      onClose()
      onInstalled?.(targetInstance.id)
    }
  }

  const externalUrl = projectUrl(project)

  return (
    <Modal
      open={open}
      title={project.name}
      subtitle={`${project.author || 'Minecraft'} · ${project.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}`}
      onClose={installing ? () => undefined : onClose}
      wide
      className="project-modal"
      footer={
        installing && install ? (
          <>
            <button type="button" className="btn btn--secondary" onClick={() => void cancelInstall()}>
              Отменить установку
            </button>
            <button type="button" className="btn btn--primary" disabled>
              <span className="spinner spinner--small" />
              Устанавливаем…
            </button>
          </>
        ) : (
          <>
            {externalUrl ? (
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => void openExternal(externalUrl)}
              >
                <ExternalIcon size={15} />
                Страница проекта
              </button>
            ) : null}
            <span className="modal__spacer" />
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Закрыть
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleInstall()}
              disabled={!selectedVersion || loading || installing}
            >
              {project.projectType === 'modpack' ? <DownloadIcon size={16} /> : <PlusIcon size={16} />}
              {project.projectType === 'modpack' ? 'Установить сборку' : 'Установить файл'}
            </button>
          </>
        )
      }
    >
      <div className="project-detail">
        <div className="project-detail__summary">
          <span className="project-detail__icon">
            {project.iconUrl ? (
              <img src={project.iconUrl} alt="" loading="lazy" />
            ) : (
              <BoxFallback />
            )}
          </span>
          <div className="project-detail__about">
            <p>{project.description}</p>
            <div className="project-detail__stats">
              <span>
                <DownloadIcon size={14} />
                {formatDownloads(project.downloads)} загрузок
              </span>
              <span>{formatDownloads(project.follows)} подписчиков</span>
              <span>{formatDate(project.dateModified)}</span>
            </div>
            <div className="project-detail__tags">
              {project.categories.slice(0, 6).map((category) => (
                <span className="tag" key={category}>
                  {category}
                </span>
              ))}
            </div>
          </div>
        </div>

        {contentMode ? (
          <div className="project-detail__instance">
            {instances.length === 0 ? (
              <div className="callout callout--info">
                <AlertIcon size={18} />
                <span>Сначала создайте инстанс — контент устанавливается внутрь него.</span>
                {onCreateInstance ? (
                  <button
                    type="button"
                    className="btn btn--secondary btn--small"
                    onClick={() => {
                      onClose()
                      onCreateInstance()
                    }}
                  >
                    Создать инстанс
                  </button>
                ) : null}
              </div>
            ) : (
              <label className="field">
                <span>Куда установить</span>
                <select
                  className="input"
                  value={instanceId}
                  onChange={(event) => setInstanceId(event.target.value)}
                  disabled={installing}
                >
                  {instances.map((instance) => (
                    <option
                      key={instance.id}
                      value={instance.id}
                      disabled={project.projectType === 'mod' && instance.loader === 'vanilla'}
                    >
                      {instance.name} · Minecraft {instance.minecraftVersion} ·{' '}
                      {LOADER_LABELS[instance.loader]}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ) : (
          <div className="callout callout--info">
            <DownloadIcon size={18} />
            <span>
              Сборка будет установлена как отдельный инстанс со своим загрузчиком и папкой.
            </span>
          </div>
        )}

        <div className="project-detail__versions-head">
          <div>
            <h3>Версии</h3>
            <p>
              {loading
                ? 'Загружаем список…'
                : versionsError
                  ? 'Не удалось загрузить версии'
                  : `Доступно: ${versions.length}${visibleVersions.length < versions.length ? `, показано ${visibleVersions.length}` : ''}`}
            </p>
          </div>
          {targetInstance && contentMode ? (
            <label className="check-line">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
                disabled={installing}
              />
              Все версии
            </label>
          ) : null}
        </div>

        {versionsError ? (
          <div className="callout callout--error">
            <AlertIcon size={18} />
            <span>{versionsError}</span>
          </div>
        ) : null}

        <div className="version-picker">
          {loading ? (
            <div className="version-picker__empty">
              <span className="spinner" />
              Загружаем версии…
            </div>
          ) : visibleVersions.length === 0 ? (
            <div className="version-picker__empty">
              Нет версий{targetInstance ? ` для Minecraft ${targetInstance.minecraftVersion}` : ''}.
              {targetInstance && !showAll ? ' Попробуйте включить «Все версии».' : ''}
            </div>
          ) : (
            visibleVersions.map((version) => {
              const selected = version.id === selectedVersionId
              const compatible = isCompatible(project, version, targetInstance)
              return (
                <button
                  type="button"
                  key={version.id}
                  className={`version-option${selected ? ' version-option--selected' : ''}`}
                  onClick={() => setSelectedVersionId(version.id)}
                  disabled={installing}
                >
                  <span className={`version-option__check${selected ? ' version-option__check--on' : ''}`}>
                    {selected ? <CheckIcon size={12} /> : null}
                  </span>
                  <span className="version-option__main">
                    <strong>{version.versionNumber}</strong>
                    <small>{version.name}</small>
                  </span>
                  <span className="version-option__tags">
                    {version.gameVersions.slice(0, 2).map((gameVersion) => (
                      <span className="tag" key={gameVersion}>
                        {gameVersion}
                      </span>
                    ))}
                    {version.loaders.slice(0, 2).map((loader) => (
                      <span className="tag" key={loader}>
                        {loader}
                      </span>
                    ))}
                  </span>
                  <span className="version-option__meta">
                    <small>{formatDate(version.publishedAt)}</small>
                    <small>{formatBytes(version.fileSize)}</small>
                  </span>
                  {compatible === false ? (
                    <span className="badge badge--warning">несовместимо</span>
                  ) : null}
                </button>
              )
            })
          )}
        </div>

        {formError ? <p className="form-error">{formError}</p> : null}
        {selectedVersion && selectedCompatible === false && contentMode ? (
          <div className="callout callout--error">
            <AlertIcon size={18} />
            <span>
              Выбранная версия не подходит инстансу по версии Minecraft или загрузчику.
              Установка может быть отклонена.
            </span>
          </div>
        ) : null}

        {installing && install ? (
          <div className="modal-progress">
            <div className="modal-progress__head">
              <span className="modal-progress__icon">
                <DownloadIcon size={16} />
              </span>
              <div>
                <strong>{STAGE_LABELS[install.stage]}</strong>
                <p>{install.message}</p>
              </div>
              <span className="modal-progress__percent">{install.percent}%</span>
            </div>
            <ProgressBar percent={install.percent} label="Установка контента" />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}

function isCompatible(
  project: CatalogProject,
  version: CatalogVersion | null,
  instance: Instance | null
): boolean | null {
  if (!version || !instance || project.projectType === 'modpack') return null
  if (
    version.gameVersions.length > 0 &&
    !version.gameVersions.includes(instance.minecraftVersion)
  ) {
    return false
  }
  if (
    project.projectType === 'mod' &&
    version.loaders.length > 0 &&
    !version.loaders.includes(instance.loader)
  ) {
    return false
  }
  return true
}

function projectUrl(project: CatalogProject): string | null {
  if (project.source === 'modrinth') {
    const type =
      project.projectType === 'modpack'
        ? 'modpack'
        : project.projectType === 'resourcepack'
          ? 'resourcepack'
          : project.projectType
    return `https://modrinth.com/${type}/${project.slug}`
  }
  const type =
    project.projectType === 'modpack'
      ? 'modpacks'
      : project.projectType === 'resourcepack'
        ? 'texture-packs'
        : project.projectType === 'mod'
          ? 'mc-mods'
          : 'shaders'
  return `https://www.curseforge.com/minecraft/${type}/${project.slug}`
}

function BoxFallback() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 8.5 12 3 3 8.5v7L12 21l9-5.5v-7Z" />
      <path d="m3.3 8.7 8.7 5.2 8.7-5.2" />
      <path d="M12 21v-7.1" />
    </svg>
  )
}
