import type {
  CatalogSource,
  ContentType,
  InstallStage,
  LoaderType
} from '@shared/types'

export const STAGE_LABELS: Record<InstallStage, string> = {
  preparing: 'Подготовка',
  version: 'Описание версии',
  client: 'Клиент',
  libraries: 'Библиотеки',
  assets: 'Ресурсы',
  natives: 'Нативные библиотеки',
  loader: 'Загрузчик',
  content: 'Контент',
  finishing: 'Завершение'
}

export const LOADER_LABELS: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  modpack: 'Модпаки',
  mod: 'Моды',
  shader: 'Шейдеры',
  resourcepack: 'Ресурспаки'
}

export const CONTENT_TYPE_SINGULAR: Record<ContentType, string> = {
  modpack: 'Модпак',
  mod: 'Мод',
  shader: 'Шейдер',
  resourcepack: 'Ресурспак'
}

export const CATALOG_SOURCE_LABELS: Record<CatalogSource, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} КБ`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`
}

export function formatDate(value: string | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(date)
}

export function formatDateTime(timestamp: number | undefined): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(timestamp))
}

export function formatMemory(megabytes: number): string {
  if (megabytes >= 1024) {
    const gigabytes = megabytes / 1024
    return `${Number.isInteger(gigabytes) ? gigabytes : gigabytes.toFixed(1)} ГБ`
  }
  return `${megabytes} МБ`
}

export function shortUuid(uuid: string): string {
  return uuid.length > 13 ? `${uuid.slice(0, 8)}…${uuid.slice(-4)}` : uuid
}

export function versionTypeLabel(type: string): string {
  switch (type) {
    case 'release':
      return 'Релиз'
    case 'snapshot':
      return 'Снапшот'
    case 'old_beta':
      return 'Бета'
    case 'old_alpha':
      return 'Альфа'
    default:
      return type
  }
}

export function formatDownloads(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return `${millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)} млн`
  }
  if (value >= 1000) {
    const thousands = value / 1000
    return `${thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1)} тыс.`
  }
  return String(Math.round(value))
}

export function formatPlaytime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Ещё не играли'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (hours <= 0) return `${Math.max(1, minutes)} мин`
  if (minutes <= 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

export function formatRelativeDate(value: string | number | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} ч назад`
  if (diff < 30 * 86_400_000) return `${Math.round(diff / 86_400_000)} дн назад`
  return formatDate(typeof value === 'number' ? new Date(value).toISOString() : value)
}

export function instanceInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? 'C'
}

export function pluralWord(count: number, one: string, few: string, many: string): string {
  const value = Math.abs(Math.trunc(count))
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function plural(count: number, one: string, few: string, many: string): string {
  return `${count} ${pluralWord(count, one, few, many)}`
}
