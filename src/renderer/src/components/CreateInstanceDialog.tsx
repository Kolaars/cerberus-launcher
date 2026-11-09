import { useEffect, useMemo, useState } from 'react'
import type { LoaderType, LoaderVersionInfo } from '@shared/types'
import { useLauncher } from '../context/LauncherContext'
import { LOADER_LABELS, STAGE_LABELS } from '../lib/format'
import { Modal } from './Modal'
import { ProgressBar } from './ProgressBar'
import { BoxIcon, CheckIcon, DownloadIcon } from './Icons'

const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

export function CreateInstanceDialog({
  open,
  onClose,
  onCreated
}: {
  open: boolean
  onClose: () => void
  onCreated: (instanceId: string) => void
}) {
  const {
    remote,
    installed,
    settings,
    install,
    cancelInstall,
    createInstance,
    listLoaderVersions
  } = useLauncher()

  const [name, setName] = useState('')
  const [minecraftVersion, setMinecraftVersion] = useState('')
  const [loader, setLoader] = useState<LoaderType>('fabric')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionInfo[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const versions = useMemo(() => {
    const map = new Map<string, { id: string; installed: boolean; releaseTime: string }>()
    for (const version of remote) {
      if (version.type !== 'release' && !settings.showSnapshots) continue
      map.set(version.id, {
        id: version.id,
        installed: false,
        releaseTime: version.releaseTime
      })
    }
    for (const version of installed) {
      map.set(version.id, {
        id: version.id,
        installed: true,
        releaseTime: version.releaseTime
      })
    }
    return [...map.values()].sort(
      (a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime)
    )
  }, [remote, installed, settings.showSnapshots])

  useEffect(() => {
    if (!open) return
    setName('')
    setDescription('')
    setLoader('fabric')
    setLoaderVersion('')
    setFormError(null)
    setSubmitting(false)
  }, [open])

  useEffect(() => {
    if (!open || minecraftVersion || versions.length === 0) return
    setMinecraftVersion(
      versions.find((version) => version.installed)?.id ?? versions[0].id
    )
  }, [open, minecraftVersion, versions])

  useEffect(() => {
    let cancelled = false
    setLoaderVersions([])
    setLoaderVersion('')
    if (!open || loader === 'vanilla' || !minecraftVersion) {
      setLoadingVersions(false)
      return
    }

    setLoadingVersions(true)
    void listLoaderVersions(loader, minecraftVersion)
      .then((list) => {
        if (cancelled) return
        setLoaderVersions(list)
        const preferred = list.find((entry) => entry.stable) ?? list[0]
        setLoaderVersion(preferred?.version ?? '')
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, loader, minecraftVersion, listLoaderVersions])

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      setFormError('Введите название инстанса.')
      return
    }
    if (!minecraftVersion) {
      setFormError('Выберите версию Minecraft.')
      return
    }
    if (loader !== 'vanilla' && !loaderVersion) {
      setFormError(
        loadingVersions
          ? 'Дождитесь загрузки версий загрузчика.'
          : `Для ${LOADER_LABELS[loader]} не найдено версий под Minecraft ${minecraftVersion}.`
      )
      return
    }

    setFormError(null)
    setSubmitting(true)
    const result = await createInstance({
      name: name.trim(),
      minecraftVersion,
      loader,
      loaderVersion: loader === 'vanilla' ? null : loaderVersion,
      description: description.trim()
    })
    setSubmitting(false)
    if (result?.instanceId) {
      onClose()
      onCreated(result.instanceId)
    }
  }

  return (
    <Modal
      open={open}
      title="Новый инстанс"
      subtitle="Изолированная сборка: своя папка, версия, загрузчик и контент."
      onClose={submitting ? () => undefined : onClose}
      wide
      footer={
        submitting && install ? (
          <>
            <button type="button" className="btn btn--secondary" onClick={() => void cancelInstall()}>
              Отменить установку
            </button>
            <button type="button" className="btn btn--primary" disabled>
              <span className="spinner spinner--small" />
              Создаём…
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void handleSubmit()}
              disabled={submitting || loadingVersions}
            >
              {submitting ? <span className="spinner spinner--small" /> : <CheckIcon size={16} />}
              {submitting ? 'Создаём…' : 'Создать инстанс'}
            </button>
          </>
        )
      }
    >
      <div className="create-instance">
        <div className="create-instance__grid">
          <label className="field">
            <span>Название</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Например, Tech Adventures"
              maxLength={64}
              autoFocus
              disabled={submitting}
            />
          </label>

          <label className="field">
            <span>Версия Minecraft</span>
            <select
              className="input"
              value={minecraftVersion}
              onChange={(event) => setMinecraftVersion(event.target.value)}
              disabled={submitting || versions.length === 0}
            >
              {versions.length === 0 ? <option value="">Версии не загружены</option> : null}
              {versions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.id}
                  {version.installed ? ' · установлена' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span>Загрузчик</span>
          <div className="loader-picker">
            {LOADERS.map((entry) => (
              <button
                key={entry}
                type="button"
                className={`loader-option loader-option--${entry}${loader === entry ? ' loader-option--active' : ''}`}
                onClick={() => setLoader(entry)}
                disabled={submitting}
              >
                <span
                  className={`loader-option__mark loader-option__mark--${entry}`}
                  aria-hidden="true"
                >
                  {entry === 'vanilla' ? <BoxIcon size={16} /> : LOADER_LABELS[entry].slice(0, 1)}
                </span>
                {LOADER_LABELS[entry]}
              </button>
            ))}
          </div>
        </div>

        {loader !== 'vanilla' ? (
          <label className="field">
            <span>Версия загрузчика</span>
            <select
              className="input"
              value={loaderVersion}
              onChange={(event) => setLoaderVersion(event.target.value)}
              disabled={submitting || loadingVersions || loaderVersions.length === 0}
            >
              {loadingVersions ? <option value="">Загружаем версии…</option> : null}
              {!loadingVersions && loaderVersions.length === 0 ? (
                <option value="">Версии не найдены</option>
              ) : null}
              {loaderVersions.map((version) => (
                <option key={version.version} value={version.version}>
                  {version.version}
                  {version.stable ? ' · стабильная' : ' · тестовая'}
                </option>
              ))}
            </select>
            <small className="field-hint">
              {loadingVersions
                ? 'Запрашиваем список у серверов загрузчика…'
                : loaderVersions.length > 0
                  ? `Доступно версий: ${loaderVersions.length}. По умолчанию выбрана стабильная.`
                  : `Для Minecraft ${minecraftVersion} версии ${LOADER_LABELS[loader]} не найдены.`}
            </small>
          </label>
        ) : (
          <div className="callout callout--info">
            <BoxIcon size={18} />
            <span>
              Vanilla-инстанс подходит для ванильной игры и ресурспаков. Моды и шейдеры
              требуют Fabric, Quilt, Forge или NeoForge.
            </span>
          </div>
        )}

        <label className="field">
          <span>Описание</span>
          <textarea
            className="input textarea"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Необязательно: для чего этот инстанс"
            maxLength={500}
            disabled={submitting}
          />
        </label>

        {formError ? <p className="form-error">{formError}</p> : null}

        {submitting ? (
          <div className="modal-progress">
            <div className="modal-progress__head">
              <span className="modal-progress__icon">
                <DownloadIcon size={16} />
              </span>
              <div>
                <strong>
                  {install ? STAGE_LABELS[install.stage] : 'Подготовка инстанса'}
                </strong>
                <p>{install?.message ?? 'Проверяем версии и готовим установку…'}</p>
              </div>
              <span className="modal-progress__percent">{install?.percent ?? 0}%</span>
            </div>
            <ProgressBar percent={install?.percent ?? 0} label="Создание инстанса" />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
