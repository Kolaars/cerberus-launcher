import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { InstalledVersion, LoaderType, VersionType } from '@shared/types'
import { fileSize, readJson, removePath, writeJsonAtomic } from '../../utils/fs'
import { log } from '../../utils/logger'
import type { ConfigStore } from '../config-store'
import type { InstanceService } from '../instances'
import type { InstallMarker } from './types'

export const MARKER_FILE = '.cerberus.json'

export class InstalledService {
  constructor(
    private readonly config: ConfigStore,
    private readonly instances: InstanceService
  ) {}

  gameDirectory(instanceId?: string): string {
    return instanceId
      ? this.instances.minecraftDirectory(instanceId)
      : this.config.get().gameDirectory
  }

  librariesDirectory(): string {
    return join(this.config.get().gameDirectory, 'libraries')
  }

  assetsDirectory(): string {
    return join(this.config.get().gameDirectory, 'assets')
  }

  versionsDirectory(instanceId?: string): string {
    return instanceId
      ? this.instances.versionsDirectory(instanceId)
      : join(this.config.get().gameDirectory, 'versions')
  }

  versionDirectory(versionId: string, instanceId?: string): string {
    const root = resolve(this.versionsDirectory(instanceId))
    const directory = resolve(root, versionId)
    if (directory === root || !directory.startsWith(`${root}${sep}`)) {
      throw new Error('Некорректный идентификатор версии Minecraft.')
    }
    return directory
  }

  versionJsonPath(versionId: string, instanceId?: string): string {
    return join(this.versionDirectory(versionId, instanceId), `${versionId}.json`)
  }

  clientJarPath(versionId: string, instanceId?: string): string {
    return join(this.versionDirectory(versionId, instanceId), `${versionId}.jar`)
  }

  markerPath(versionId: string, instanceId?: string): string {
    return join(this.versionDirectory(versionId, instanceId), MARKER_FILE)
  }

  list(instanceId?: string): InstalledVersion[] {
    if (instanceId && !this.instances.exists(instanceId)) return []
    const root = this.versionsDirectory(instanceId)
    if (!existsSync(root)) return []

    const result: InstalledVersion[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const installed = this.get(entry.name, instanceId)
      if (installed) result.push(installed)
    }

    result.sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime))
    return result
  }

  get(versionId: string, instanceId?: string): InstalledVersion | null {
    const marker = readJson<InstallMarker>(this.markerPath(versionId, instanceId))
    if (!marker || marker.version !== 1 || marker.id !== versionId) return null
    if (!existsSync(this.versionJsonPath(versionId, instanceId))) return null
    if ((fileSize(this.clientJarPath(versionId, instanceId)) ?? 0) <= 0) return null

    return {
      id: marker.id,
      type: marker.type as VersionType,
      releaseTime: marker.releaseTime,
      installedAt: marker.installedAt,
      loader: (marker.loader as LoaderType) ?? 'vanilla'
    }
  }

  isInstalled(versionId: string, instanceId?: string): boolean {
    return this.get(versionId, instanceId) !== null
  }

  hasClientJar(versionId: string, instanceId?: string): boolean {
    return (fileSize(this.clientJarPath(versionId, instanceId)) ?? 0) > 0
  }

  markInstalled(
    input: {
      id: string
      type: string
      releaseTime: string
      loader?: LoaderType
    },
    instanceId?: string
  ): void {
    const marker: InstallMarker = {
      version: 1,
      id: input.id,
      type: input.type,
      releaseTime: input.releaseTime,
      installedAt: Date.now(),
      loader: input.loader ?? 'vanilla'
    }
    writeJsonAtomic(this.markerPath(input.id, instanceId), marker)
    log.info(
      'installed',
      `Версия ${input.id}${instanceId ? ` (инстанс ${instanceId})` : ''} отмечена установленной`
    )
  }

  remove(versionId: string, instanceId?: string): void {
    removePath(this.versionDirectory(versionId, instanceId))
    log.info(
      'installed',
      `Версия ${versionId}${instanceId ? ` (инстанс ${instanceId})` : ''} удалена`
    )
  }
}
