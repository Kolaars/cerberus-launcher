import { useState, type CSSProperties } from 'react'
import type { CatalogProject } from '@shared/types'
import {
  BoxIcon,
  DownloadIcon,
  ImageIcon,
  PuzzleIcon,
  WandIcon
} from './Icons'
import {
  CATALOG_SOURCE_LABELS,
  CONTENT_TYPE_SINGULAR,
  formatDownloads,
  LOADER_LABELS
} from '../lib/format'

export function ProjectCard({
  project,
  onOpen,
  installing = false
}: {
  project: CatalogProject
  onOpen: () => void
  installing?: boolean
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const Icon = iconForType(project.projectType)
  const showImage = Boolean(project.iconUrl) && !imageFailed
  const tags = [
    ...project.loaders
      .filter((loader) => loader in LOADER_LABELS)
      .map((loader) => LOADER_LABELS[loader as keyof typeof LOADER_LABELS]),
    ...project.categories.filter(
      (category) => !['fabric', 'quilt', 'forge', 'neoforge'].includes(category)
    )
  ].slice(0, 3)

  return (
    <article
      className="project-card"
      data-source={project.source}
      style={
        showImage
          ? ({ '--project-art': `url("${project.iconUrl}")` } as CSSProperties)
          : undefined
      }
    >
      <button type="button" className="project-card__main" onClick={onOpen}>
        <span className="project-card__icon">
          {showImage ? (
            <img
              src={project.iconUrl}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Icon size={24} />
          )}
        </span>

        <div className="project-card__head">
          <div className="project-card__title">
            <strong>{project.name}</strong>
            <span className="project-card__author">{project.author || 'Minecraft'}</span>
          </div>
          <span className={`source-badge source-badge--${project.source}`}>
            {CATALOG_SOURCE_LABELS[project.source]}
          </span>
        </div>

        <p className="project-card__description">{project.description}</p>

        <div className="project-card__tags">
          <span className="badge badge--outline">{CONTENT_TYPE_SINGULAR[project.projectType]}</span>
          {tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>

        <div className="project-card__footer">
          <span className="project-card__stat">
            <DownloadIcon size={14} />
            {formatDownloads(project.downloads)}
          </span>
          {project.gameVersions.length > 0 ? (
            <span className="project-card__versions">
              {project.gameVersions.slice(0, 3).join(' · ')}
            </span>
          ) : null}
        </div>
      </button>

      <button
        type="button"
        className="btn btn--secondary btn--small project-card__install"
        onClick={onOpen}
        disabled={installing}
      >
        {project.projectType === 'modpack' ? 'Установить' : 'Добавить'}
      </button>
    </article>
  )
}

function iconForType(type: CatalogProject['projectType']) {
  switch (type) {
    case 'shader':
      return WandIcon
    case 'resourcepack':
      return ImageIcon
    case 'mod':
      return PuzzleIcon
    default:
      return BoxIcon
  }
}
