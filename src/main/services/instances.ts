import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type {
  CreateInstanceRequest,
  Instance,
  InstanceContent,
  InstanceSource,
  LoaderType
} from '@shared/types'
import { randomBytes } from 'node:crypto'
import { ensureDir, readJson, removePath, writeJsonAtomic } from '../utils/fs'
import { log } from '../utils/logger'
import type { ConfigStore } from './config-store'

interface StoredInstance {
  version: 1
  id: string
  name: string
  description: string
  iconUrl?: string
  minecraftVersion: string
  loader: LoaderType
  loaderVersion: string | null
  launchVersionId: string
  source: InstanceSource
  projectId?: string
  projectVersionId?: string
  projectVersionName?: string
  createdAt: number
  lastPlayedAt: number | null
  playtimeSeconds: number
}

interface ContentManifest {
  version: 1
  items: InstanceContent[]
}

const INSTANCE_ID = /^[a-z0-9][a-z0-9_-]{2,63}$/

export class InstanceService {
  constructor(private readonly config: ConfigStore) {}

  rootDirectory(): string {
    return join(this.config.get().gameDirectory, 'instances')
  }

  instanceDirectory(instanceId: string): string {
    this.assertId(instanceId)
    const root = resolve(this.rootDirectory())
    const directory = resolve(root, instanceId)
    if (directory === root || !directory.startsWith(`${root}${sep}`)) {
      throw new Error('Некорректный идентификатор инстанса.')
    }
    return directory
  }

  metadataPath(instanceId: string): string {
    return join(this.instanceDirectory(instanceId), 'instance.json')
  }

  minecraftDirectory(instanceId: string): string {
    return join(this.instanceDirectory(instanceId), 'minecraft')
  }

  versionsDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'versions')
  }

  librariesDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'libraries')
  }

  modsDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'mods')
  }

  resourcePacksDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'resourcepacks')
  }

  shaderPacksDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'shaderpacks')
  }

  savesDirectory(instanceId: string): string {
    return join(this.minecraftDirectory(instanceId), 'saves')
  }

  contentManifestPath(instanceId: string): string {
    return join(this.instanceDirectory(instanceId), 'content.json')
  }

  exists(instanceId: string): boolean {
    try {
      return existsSync(this.metadataPath(instanceId))
    } catch {
      return false
    }
  }

  list(): Instance[] {
    const root = this.rootDirectory()
    if (!existsSync(root)) return []

    const result: Instance[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !INSTANCE_ID.test(entry.name)) continue
      const instance = this.get(entry.name)
      if (instance) result.push(instance)
    }

    result.sort((a, b) => {
      const left = b.lastPlayedAt ?? b.createdAt
      const right = a.lastPlayedAt ?? a.createdAt
      return left - right
    })
    return result
  }

  get(instanceId: string): Instance | null {
    const stored = readJson<StoredInstance>(this.metadataPath(instanceId))
    if (!stored || stored.version !== 1 || stored.id !== instanceId) return null
    if (!INSTANCE_ID.test(stored.id)) return null

    return {
      id: stored.id,
      name: stored.name,
      description: stored.description ?? '',
      iconUrl: stored.iconUrl,
      minecraftVersion: stored.minecraftVersion,
      loader: stored.loader,
      loaderVersion: stored.loaderVersion ?? null,
      launchVersionId: stored.launchVersionId,
      source: stored.source ?? 'manual',
      projectId: stored.projectId,
      projectVersionId: stored.projectVersionId,
      projectVersionName: stored.projectVersionName,
      createdAt: stored.createdAt,
      lastPlayedAt: stored.lastPlayedAt ?? null,
      playtimeSeconds: stored.playtimeSeconds ?? 0,
      contentCount: this.readContent(instanceId).length
    }
  }

  create(request: CreateInstanceRequest): Instance {
    const name = sanitizeName(request.name)
    if (!name) throw new Error('Название инстанса не может быть пустым.')
    if (!request.minecraftVersion || !/^[A-Za-z0-9._+-]{1,64}$/.test(request.minecraftVersion)) {
      throw new Error('Некорректная версия Minecraft.')
    }
    if (!isLoader(request.loader)) throw new Error('Неизвестный тип загрузчика.')

    const id = this.uniqueId(slugify(name))
    const now = Date.now()
    const stored: StoredInstance = {
      version: 1,
      id,
      name,
      description: request.description?.trim().slice(0, 500) ?? '',
      iconUrl: request.iconUrl?.trim() || undefined,
      minecraftVersion: request.minecraftVersion,
      loader: request.loader,
      loaderVersion: request.loaderVersion?.trim() || null,
      launchVersionId: request.minecraftVersion,
      source: request.source ?? 'manual',
      projectId: request.projectId,
      projectVersionId: request.projectVersionId,
      createdAt: now,
      lastPlayedAt: null,
      playtimeSeconds: 0
    }

    ensureDir(this.minecraftDirectory(id))
    ensureDir(this.versionsDirectory(id))
    ensureDir(this.modsDirectory(id))
    ensureDir(this.resourcePacksDirectory(id))
    ensureDir(this.shaderPacksDirectory(id))
    ensureDir(this.savesDirectory(id))
    writeJsonAtomic(this.metadataPath(id), stored)
    writeJsonAtomic(this.contentManifestPath(id), { version: 1, items: [] } satisfies ContentManifest)
    log.info('instances', `Создан инстанс ${id} (${stored.minecraftVersion}, ${stored.loader})`)
    return this.get(id)!
  }

  update(
    instanceId: string,
    patch: Partial<
      Pick<
        Instance,
        | 'name'
        | 'description'
        | 'iconUrl'
        | 'loaderVersion'
        | 'launchVersionId'
        | 'projectVersionName'
      >
    >
  ): Instance {
    const stored = readJson<StoredInstance>(this.metadataPath(instanceId))
    if (!stored) throw new Error('Инстанс не найден.')

    if (patch.name !== undefined) {
      const name = sanitizeName(patch.name)
      if (!name) throw new Error('Название инстанса не может быть пустым.')
      stored.name = name
    }
    if (patch.description !== undefined) {
      stored.description = patch.description.trim().slice(0, 500)
    }
    if (patch.iconUrl !== undefined) stored.iconUrl = patch.iconUrl.trim() || undefined
    if (patch.loaderVersion !== undefined) stored.loaderVersion = patch.loaderVersion
    if (patch.launchVersionId !== undefined) stored.launchVersionId = patch.launchVersionId
    if (patch.projectVersionName !== undefined) {
      stored.projectVersionName = patch.projectVersionName
    }

    writeJsonAtomic(this.metadataPath(instanceId), stored)
    return this.get(instanceId)!
  }

  touchLaunched(instanceId: string): void {
    const stored = readJson<StoredInstance>(this.metadataPath(instanceId))
    if (!stored) return
    stored.lastPlayedAt = Date.now()
    writeJsonAtomic(this.metadataPath(instanceId), stored)
  }

  addPlaytime(instanceId: string, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return
    const stored = readJson<StoredInstance>(this.metadataPath(instanceId))
    if (!stored) return
    stored.playtimeSeconds = Math.max(0, Math.round((stored.playtimeSeconds ?? 0) + seconds))
    writeJsonAtomic(this.metadataPath(instanceId), stored)
  }

  remove(instanceId: string): void {
    removePath(this.instanceDirectory(instanceId))
    log.info('instances', `Инстанс ${instanceId} удалён`)
  }

  listContent(instanceId: string): InstanceContent[] {
    return this.readContent(instanceId).sort((a, b) => b.installedAt - a.installedAt)
  }

  addContent(instanceId: string, items: InstanceContent[]): InstanceContent[] {
    const current = this.readContent(instanceId)
    const seen = new Set(current.map((item) => item.id))
    for (const item of items) {
      if (!seen.has(item.id)) {
        current.push(item)
        seen.add(item.id)
      }
    }
    this.writeContent(instanceId, current)
    return this.listContent(instanceId)
  }

  removeContentRecord(instanceId: string, contentId: string): InstanceContent {
    const current = this.readContent(instanceId)
    const item = current.find((entry) => entry.id === contentId)
    if (!item) throw new Error('Установленный контент не найден.')
    this.writeContent(
      instanceId,
      current.filter((entry) => entry.id !== contentId)
    )
    return item
  }

  private readContent(instanceId: string): InstanceContent[] {
    const manifest = readJson<ContentManifest>(this.contentManifestPath(instanceId))
    if (!manifest || !Array.isArray(manifest.items)) return []
    return manifest.items.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.relativePath === 'string' &&
        typeof item.fileName === 'string'
    )
  }

  private writeContent(instanceId: string, items: InstanceContent[]): void {
    writeJsonAtomic(this.contentManifestPath(instanceId), {
      version: 1,
      items
    } satisfies ContentManifest)
  }

  private uniqueId(base: string): string {
    for (let attempt = 0; attempt < 20; attempt++) {
      const suffix = randomBytes(3).toString('hex')
      const candidate = `${base.slice(0, 36)}-${suffix}`
      if (!this.exists(candidate)) return candidate
    }
    return `instance-${Date.now().toString(36)}`
  }

  private assertId(instanceId: string): void {
    if (!INSTANCE_ID.test(instanceId)) {
      throw new Error('Некорректный идентификатор инстанса.')
    }
  }
}

function sanitizeName(value: string): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
}

function slugify(value: string): string {
  const latin = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return latin || 'instance'
}

function isLoader(value: string): value is LoaderType {
  return ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(value)
}
