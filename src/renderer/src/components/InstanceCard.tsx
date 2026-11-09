import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import type { Instance, LaunchState } from '@shared/types'
import {
  BoxIcon,
  ChevronRightIcon,
  FolderIcon,
  PlayIcon,
  StopIcon
} from './Icons'
import {
  formatPlaytime,
  formatRelativeDate,
  instanceInitial,
  LOADER_LABELS,
  plural
} from '../lib/format'

const ACTIVE = ['starting', 'running', 'stopping']

export function InstanceCard({
  instance,
  launch,
  busy,
  onPlay,
  onStop,
  onOpen,
  onOpenFolder
}: {
  instance: Instance
  launch: LaunchState
  busy: boolean
  onPlay: () => void
  onStop: () => void
  onOpen: () => void
  onOpenFolder: () => void
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const active = ACTIVE.includes(launch.status) && launch.instanceId === instance.id
  const otherActive = ACTIVE.includes(launch.status) && launch.instanceId !== instance.id
  const showImage = Boolean(instance.iconUrl) && !imageFailed

  const open = (): void => onOpen()
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }
  const stop = (event: MouseEvent): void => {
    event.stopPropagation()
    if (active) onStop()
    else onPlay()
  }
  const folder = (event: MouseEvent): void => {
    event.stopPropagation()
    onOpenFolder()
  }

  return (
    <article
      className={`instance-card${active ? ' instance-card--active' : ''}`}
      data-loader={instance.loader}
      style={
        showImage
          ? ({ '--instance-art': `url("${instance.iconUrl}")` } as CSSProperties)
          : undefined
      }
      onClick={open}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`Инстанс ${instance.name}`}
    >
      <div className="instance-card__glow" aria-hidden="true" />
      <div className="instance-card__head">
        <span className={`instance-icon${showImage ? ' instance-icon--image' : ''}`}>
          {showImage ? (
            <img
              src={instance.iconUrl}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span>{instanceInitial(instance.name)}</span>
          )}
        </span>
        <div className="instance-card__title">
          <strong>{instance.name}</strong>
          <span className={`loader-badge loader-badge--${instance.loader}`}>
            {LOADER_LABELS[instance.loader]}
          </span>
        </div>
        <ChevronRightIcon size={16} />
      </div>

      <p className="instance-card__description">
        {instance.description || `${instance.minecraftVersion} · ${LOADER_LABELS[instance.loader]}`}
      </p>

      <div className="instance-card__meta">
        <span className="instance-card__mc">{instance.minecraftVersion}</span>
        {instance.loaderVersion ? (
          <span className="instance-card__loader-version">{instance.loaderVersion}</span>
        ) : null}
        <span className="instance-card__dot" />
        <span>{plural(instance.contentCount, 'файл', 'файла', 'файлов')}</span>
      </div>

      <div className="instance-card__footer">
        <div className="instance-card__activity">
          <BoxIcon size={14} />
          <span title={instance.lastPlayedAt ? new Date(instance.lastPlayedAt).toLocaleString('ru-RU') : undefined}>
            {instance.lastPlayedAt
              ? formatRelativeDate(instance.lastPlayedAt)
              : 'Новый инстанс'}
          </span>
          <span className="instance-card__dot" />
          <span>{formatPlaytime(instance.playtimeSeconds)}</span>
        </div>

        <div className="instance-card__actions">
          <button
            type="button"
            className="icon-button"
            onClick={folder}
            title="Открыть папку инстанса"
            aria-label="Открыть папку инстанса"
          >
            <FolderIcon size={15} />
          </button>
          <button
            type="button"
            className={`btn btn--small ${active ? 'btn--secondary' : 'btn--primary'}`}
            onClick={stop}
            disabled={busy || otherActive}
            title={otherActive ? 'Сначала остановите другую игру' : undefined}
          >
            {active ? <StopIcon size={14} /> : <PlayIcon size={14} />}
            {active ? 'Стоп' : 'Играть'}
          </button>
        </div>
      </div>
    </article>
  )
}
