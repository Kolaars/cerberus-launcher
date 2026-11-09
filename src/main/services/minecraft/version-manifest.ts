import { readJson, writeJsonAtomic } from '../../utils/fs'
import { fetchJson } from '../../utils/http'
import { log } from '../../utils/logger'
import type { AppPaths } from '../paths'
import type { ManifestVersion, VersionJson, VersionManifest } from './types'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const CACHE_TTL_MS = 30 * 60 * 1000

interface ManifestCache {
  fetchedAt: number
  data: VersionManifest
}

export class VersionManifestService {
  private memory: VersionManifest | null = null
  private readonly cacheFile: string

  constructor(paths: AppPaths) {
    this.cacheFile = `${paths.cacheDirectory}/version_manifest_v2.json`
  }

  async getManifest(force = false): Promise<VersionManifest> {
    if (!force && this.memory) return this.memory

    const cached = readJson<ManifestCache>(this.cacheFile)
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      this.memory = cached.data
      return cached.data
    }

    try {
      const data = await fetchJson<VersionManifest>(MANIFEST_URL)
      writeJsonAtomic(this.cacheFile, { fetchedAt: Date.now(), data } satisfies ManifestCache)
      this.memory = data
      log.info('manifest', `Манифест обновлён: ${data.versions.length} версий`)
      return data
    } catch (error) {
      if (cached) {
        log.warn('manifest', `Не удалось обновить манифест, использую кэш: ${String(error)}`)
        this.memory = cached.data
        return cached.data
      }
      throw new Error(`Не удалось получить список версий Minecraft: ${String(error)}`)
    }
  }

  async getEntry(versionId: string): Promise<ManifestVersion> {
    const manifest = await this.getManifest()
    const entry = manifest.versions.find((version) => version.id === versionId)
    if (!entry) {
      throw new Error(`Версия ${versionId} не найдена в манифесте Mojang.`)
    }
    return entry
  }

  async fetchVersionJson(entry: ManifestVersion): Promise<VersionJson> {
    return fetchJson<VersionJson>(entry.url)
  }
}
