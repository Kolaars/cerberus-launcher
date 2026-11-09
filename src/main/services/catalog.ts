import type {
  CatalogProject,
  CatalogSearchRequest,
  CatalogSearchResult,
  CatalogSource,
  CatalogVersion,
  ContentType,
  LoaderType
} from '@shared/types'
import { fetchJson, HttpError } from '../utils/http'
import { log } from '../utils/logger'
import type { ConfigStore } from './config-store'

const MODRINTH_API = 'https://api.modrinth.com/v2'
const CURSEFORGE_API = 'https://api.curseforge.com/v1'
const CURSEFORGE_GAME_ID = 432
const CACHE_TTL = 2 * 60 * 1000

const CURSEFORGE_CLASS: Record<ContentType, number> = {
  modpack: 4471,
  mod: 6,
  shader: 6552,
  resourcepack: 12
}

const CURSEFORGE_LOADER: Record<Exclude<LoaderType, 'vanilla'>, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

interface CacheEntry {
  fetchedAt: number
  data: unknown
}

interface ModrinthHit {
  project_id: string
  project_type: string
  slug: string
  title: string
  description: string
  author: string
  icon_url?: string | null
  downloads: number
  follows: number
  categories: string[]
  versions: string[]
  date_modified: string
  latest_version?: string
  gallery?: string[]
}

interface ModrinthSearchResponse {
  hits: ModrinthHit[]
  total_hits: number
  offset: number
  limit: number
}

interface ModrinthVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  downloads: number
  date_published: string
  files: Array<{
    url: string
    filename: string
    primary: boolean
    size: number
    hashes: { sha1?: string; sha512?: string }
  }>
}

interface ModrinthProject {
  id: string
  slug: string
  title: string
  description: string
  project_type: string
  icon_url?: string | null
  gallery?: Array<string | { url: string }>
  downloads: number
  followers: number
  categories: string[]
  versions: string[]
  updated: string
  team?: string
}

interface CurseForgeCategory {
  id: number
  name: string
  slug: string
}

interface CurseForgeMod {
  id: number
  name: string
  slug: string
  summary: string
  downloadCount: number
  thumbsUpCount: number
  dateModified: string
  classId: number
  categories: CurseForgeCategory[]
  logo?: { thumbnailUrl?: string; url?: string } | null
  links?: { websiteUrl?: string }
  latestFilesIndexes?: Array<{
    gameVersion: string
    fileId: number
    filename: string
    releaseType: number
    modLoader: number
  }>
  latestFiles?: CurseForgeFile[]
}

interface CurseForgeFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: number
  fileDate: string
  fileLength: number
  downloadCount: number
  gameVersions: string[]
  downloadUrl: string | null
  hashes: Array<{ value: string; algo: number }>
}

interface CurseForgeSearchResponse {
  data: CurseForgeMod[]
  pagination: { index: number; pageSize: number; resultCount: number; totalCount: number }
}

interface CurseForgeProjectResponse {
  data: CurseForgeMod
}

interface CurseForgeFilesResponse {
  data: CurseForgeFile[]
  pagination?: { index: number; pageSize: number; resultCount: number; totalCount: number }
}

interface CurseForgeFileResponse {
  data: CurseForgeFile
}

export interface CatalogProjectInfo {
  source: CatalogSource
  projectId: string
  projectType: ContentType
  name: string
  slug: string
  iconUrl?: string
  description: string
  author: string
}

export class CatalogService {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly config: ConfigStore) {}

  async search(request: CatalogSearchRequest): Promise<CatalogSearchResult> {
    if (request.source === 'curseforge') return this.searchCurseForge(request)
    return this.searchModrinth(request)
  }

  async featuredModpacks(): Promise<CatalogProject[]> {
    const result = await this.search({
      source: 'modrinth',
      type: 'modpack',
      sort: 'downloads',
      limit: 8,
      offset: 0
    })
    return result.projects
  }

  async listVersions(
    source: CatalogSource,
    projectId: string,
    type: ContentType,
    gameVersion?: string,
    loader?: LoaderType
  ): Promise<CatalogVersion[]> {
    if (source === 'curseforge') {
      return this.listCurseForgeVersions(projectId, type, gameVersion, loader)
    }
    return this.listModrinthVersions(projectId, type, gameVersion, loader)
  }

  async getVersion(
    source: CatalogSource,
    projectId: string,
    versionId: string
  ): Promise<CatalogVersion> {
    if (source === 'curseforge') {
      const file = await this.curseForgeFile(projectId, versionId)
      return this.mapCurseForgeFile(file, projectId)
    }

    const version = await this.cached(`modrinth:version:${versionId}`, () =>
      fetchJson<ModrinthVersion>(`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`)
    )
    return this.mapModrinthVersion(version, projectId)
  }

  /**
   * Пакетное получение файлов CurseForge для импорта manifest.json.
   * Один запрос вместо сотни последовательных обращений к API.
   */
  async resolveCurseForgeFiles(fileIds: number[]): Promise<CatalogVersion[]> {
    if (fileIds.length === 0) return []
    const apiKey = this.config.get().curseForgeApiKey.trim()
    if (!apiKey) {
      throw new Error('Для импорта CurseForge нужен API-ключ в настройках.')
    }

    const result: CatalogVersion[] = []
    for (let index = 0; index < fileIds.length; index += 50) {
      const batch = fileIds.slice(index, index + 50)
      const response = await fetchJson<CurseForgeFilesResponse>(
        `${CURSEFORGE_API}/mods/files`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ fileIds: batch })
        }
      )
      for (const file of response.data ?? []) {
        result.push(this.mapCurseForgeFile(file, String(file.modId)))
      }
    }
    return result
  }

  async getProject(
    source: CatalogSource,
    projectId: string,
    type: ContentType
  ): Promise<CatalogProjectInfo> {
    if (source === 'curseforge') {
      const response = await this.curseForgeFetch<CurseForgeProjectResponse>(
        `/mods/${encodeURIComponent(projectId)}`
      )
      const mod = response.data
      return {
        source,
        projectId: String(mod.id),
        projectType: type,
        name: mod.name,
        slug: mod.slug,
        iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url,
        description: mod.summary,
        author: ''
      }
    }

    const project = await this.cached(`modrinth:project:${projectId}`, () =>
      fetchJson<ModrinthProject>(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`)
    )
    return {
      source,
      projectId: project.id,
      projectType: normalizeType(project.project_type),
      name: project.title,
      slug: project.slug,
      iconUrl: project.icon_url ?? undefined,
      description: project.description,
      author: ''
    }
  }

  async checkCurseForge(apiKey: string): Promise<boolean> {
    const key = apiKey.trim() || this.config.get().curseForgeApiKey
    if (!key) throw new Error('Сначала укажите API-ключ CurseForge.')
    await this.curseForgeFetch('/games/432', 30_000, key)
    return true
  }

  private async searchModrinth(request: CatalogSearchRequest): Promise<CatalogSearchResult> {
    const facets: string[][] = [[`project_type:${request.type}`]]
    if (request.gameVersion) facets.push([`versions:${request.gameVersion}`])
    if (
      request.loader &&
      request.loader !== 'vanilla' &&
      (request.type === 'mod' || request.type === 'modpack')
    ) {
      facets.push([`categories:${request.loader}`])
    }

    const query = new URLSearchParams({
      query: request.query?.trim() ?? '',
      facets: JSON.stringify(facets),
      index: modrinthSort(request.sort),
      offset: String(Math.max(0, request.offset ?? 0)),
      limit: String(clampLimit(request.limit))
    })

    const data = await this.modrinthFetch<ModrinthSearchResponse>(`/search?${query.toString()}`)
    return {
      projects: data.hits.map((hit) => this.mapModrinthHit(hit, request.type)),
      total: data.total_hits,
      offset: data.offset,
      limit: data.limit
    }
  }

  private async searchCurseForge(request: CatalogSearchRequest): Promise<CatalogSearchResult> {
    const query = new URLSearchParams({
      gameId: String(CURSEFORGE_GAME_ID),
      classId: String(CURSEFORGE_CLASS[request.type]),
      index: String(Math.max(0, request.offset ?? 0)),
      pageSize: String(clampLimit(request.limit)),
      sortField: curseForgeSort(request.sort),
      sortOrder: 'desc'
    })
    if (request.query?.trim()) query.set('searchFilter', request.query.trim())
    if (request.gameVersion) query.set('gameVersion', request.gameVersion)
    if (
      request.loader &&
      request.loader !== 'vanilla' &&
      request.type !== 'shader' &&
      request.type !== 'resourcepack'
    ) {
      query.set('modLoaderType', String(CURSEFORGE_LOADER[request.loader]))
    }

    const data = await this.curseForgeFetch<CurseForgeSearchResponse>(
      `/mods/search?${query.toString()}`
    )
    return {
      projects: data.data.map((mod) => this.mapCurseForgeMod(mod, request.type)),
      total: data.pagination.totalCount,
      offset: data.pagination.index,
      limit: data.pagination.pageSize
    }
  }

  private async listModrinthVersions(
    projectId: string,
    type: ContentType,
    gameVersion?: string,
    loader?: LoaderType
  ): Promise<CatalogVersion[]> {
    const query = new URLSearchParams()
    if (gameVersion) query.set('game_versions', JSON.stringify([gameVersion]))
    if (
      loader &&
      loader !== 'vanilla' &&
      (type === 'mod' || type === 'modpack')
    ) {
      query.set('loaders', JSON.stringify([loader]))
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    const versions = await this.cached(
      `modrinth:versions:${projectId}:${type}:${gameVersion ?? ''}:${loader ?? ''}`,
      () =>
        fetchJson<ModrinthVersion[]>(
          `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version${suffix}`
        )
    )

    return versions
      .map((version) => this.mapModrinthVersion(version, projectId))
      .filter((version) => version.downloadUrl)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  }

  private async listCurseForgeVersions(
    projectId: string,
    type: ContentType,
    gameVersion?: string,
    loader?: LoaderType
  ): Promise<CatalogVersion[]> {
    const query = new URLSearchParams({
      index: '0',
      pageSize: '50'
    })
    if (gameVersion) query.set('gameVersion', gameVersion)
    if (
      loader &&
      loader !== 'vanilla' &&
      type !== 'shader' &&
      type !== 'resourcepack'
    ) {
      query.set('modLoaderType', String(CURSEFORGE_LOADER[loader]))
    }

    const response = await this.curseForgeFetch<CurseForgeFilesResponse>(
      `/mods/${encodeURIComponent(projectId)}/files?${query.toString()}`
    )
    return response.data
      .map((file) => this.mapCurseForgeFile(file, projectId))
      .filter((file) => file.downloadUrl)
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
  }

  private mapModrinthHit(hit: ModrinthHit, fallbackType: ContentType): CatalogProject {
    const loaders = hit.categories.filter((category) =>
      ['fabric', 'quilt', 'forge', 'neoforge'].includes(category)
    )
    return {
      id: `modrinth:${hit.project_id}`,
      source: 'modrinth',
      projectId: hit.project_id,
      projectType: normalizeType(hit.project_type || fallbackType),
      slug: hit.slug,
      name: hit.title,
      description: hit.description,
      author: hit.author,
      iconUrl: hit.icon_url ?? undefined,
      gallery: (hit.gallery ?? []).slice(0, 6),
      downloads: hit.downloads,
      follows: hit.follows,
      categories: hit.categories,
      gameVersions: hit.versions ?? [],
      loaders,
      dateModified: hit.date_modified,
      latestVersionId: hit.latest_version
    }
  }

  private mapModrinthVersion(version: ModrinthVersion, projectId: string): CatalogVersion {
    const file = version.files.find((entry) => entry.primary) ?? version.files[0]
    return {
      id: version.id,
      projectId: version.project_id || projectId,
      name: version.name,
      versionNumber: version.version_number,
      gameVersions: version.game_versions ?? [],
      loaders: version.loaders ?? [],
      downloads: version.downloads ?? 0,
      publishedAt: version.date_published,
      fileName: file?.filename ?? '',
      fileSize: file?.size ?? 0,
      downloadUrl: file?.url ?? '',
      sha1: file?.hashes.sha1
    }
  }

  private mapCurseForgeMod(mod: CurseForgeMod, type: ContentType): CatalogProject {
    const versions = new Set<string>()
    const loaders = new Set<string>()
    for (const index of mod.latestFilesIndexes ?? []) {
      if (index.gameVersion) versions.add(index.gameVersion)
      const loader = loaderFromCurseForge(index.modLoader)
      if (loader) loaders.add(loader)
    }
    const latest = mod.latestFilesIndexes?.[0]
    return {
      id: `curseforge:${mod.id}`,
      source: 'curseforge',
      projectId: String(mod.id),
      projectType: type,
      slug: mod.slug,
      name: mod.name,
      description: mod.summary,
      author: '',
      iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url,
      gallery: [],
      downloads: mod.downloadCount,
      follows: mod.thumbsUpCount,
      categories: mod.categories?.map((category) => category.slug ?? category.name) ?? [],
      gameVersions: [...versions],
      loaders: [...loaders],
      dateModified: mod.dateModified,
      latestVersionId: latest ? String(latest.fileId) : undefined
    }
  }

  private mapCurseForgeFile(file: CurseForgeFile, projectId: string): CatalogVersion {
    const sha1 = file.hashes.find((hash) => hash.algo === 1)?.value
    return {
      id: String(file.id),
      projectId: String(file.modId || projectId),
      name: file.displayName,
      versionNumber: file.displayName,
      gameVersions: file.gameVersions ?? [],
      loaders: file.gameVersions
        .map((value) => loaderFromCurseForgeLabel(value))
        .filter((value): value is string => Boolean(value)),
      downloads: file.downloadCount,
      publishedAt: file.fileDate,
      fileName: file.fileName,
      fileSize: file.fileLength,
      downloadUrl: file.downloadUrl ?? curseForgeCdnUrl(file),
      sha1
    }
  }

  private async curseForgeFile(projectId: string, fileId: string): Promise<CurseForgeFile> {
    const response = await this.curseForgeFetch<CurseForgeFileResponse>(
      `/mods/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
    )
    return response.data
  }

  private async modrinthFetch<T>(path: string): Promise<T> {
    return this.cached(`modrinth:${path}`, () => fetchJson<T>(`${MODRINTH_API}${path}`))
  }

  private async curseForgeFetch<T>(
    path: string,
    _timeout?: number,
    apiKeyOverride?: string
  ): Promise<T> {
    const apiKey = (apiKeyOverride ?? this.config.get().curseForgeApiKey).trim()
    if (!apiKey) {
      throw new Error('CurseForge требует API-ключ. Укажите его в настройках лаунчера.')
    }

    const cacheKey = `curseforge:${path}`
    const cached = this.cache.get(cacheKey)
    if (!apiKeyOverride && cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached.data as T
    }

    try {
      const data = await fetchJson<T>(`${CURSEFORGE_API}${path}`, {
        headers: {
          'x-api-key': apiKey,
          Accept: 'application/json'
        }
      })
      if (!apiKeyOverride) this.cache.set(cacheKey, { fetchedAt: Date.now(), data })
      return data
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 401 || error.status === 403) {
          throw new Error('CurseForge отклонил API-ключ. Проверьте ключ в настройках.')
        }
        if (error.status === 429) {
          throw new Error('CurseForge временно ограничил запросы. Попробуйте позже.')
        }
      }
      log.warn('catalog', `Ошибка CurseForge ${path}: ${String(error)}`)
      throw error
    }
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.data as T
    const data = await loader()
    this.cache.set(key, { fetchedAt: Date.now(), data })
    return data
  }
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20
  return Math.max(1, Math.min(50, Math.round(value ?? 20)))
}

function modrinthSort(sort: CatalogSearchRequest['sort']): string {
  switch (sort) {
    case 'downloads':
      return 'downloads'
    case 'updated':
      return 'updated'
    case 'newest':
      return 'newest'
    default:
      return 'relevance'
  }
}

function curseForgeSort(sort: CatalogSearchRequest['sort']): string {
  switch (sort) {
    case 'downloads':
      return '6'
    case 'updated':
    case 'newest':
      return '3'
    default:
      return '2'
  }
}

function normalizeType(value: string): ContentType {
  if (value === 'modpack') return 'modpack'
  if (value === 'shader') return 'shader'
  if (value === 'resourcepack') return 'resourcepack'
  return 'mod'
}

function loaderFromCurseForge(value: number): string | null {
  switch (value) {
    case 1:
      return 'forge'
    case 4:
      return 'fabric'
    case 5:
      return 'quilt'
    case 6:
      return 'neoforge'
    default:
      return null
  }
}

function loaderFromCurseForgeLabel(value: string): string | null {
  const normalized = value.toLowerCase()
  if (normalized === 'forge') return 'forge'
  if (normalized === 'fabric') return 'fabric'
  if (normalized === 'quilt') return 'quilt'
  if (normalized === 'neoforge') return 'neoforge'
  return null
}

function curseForgeCdnUrl(file: CurseForgeFile): string {
  const first = Math.floor(file.id / 1000)
  const second = file.id % 1000
  return `https://edge.forgecdn.net/files/${first}/${second}/${encodeURIComponent(file.fileName)}`
}
