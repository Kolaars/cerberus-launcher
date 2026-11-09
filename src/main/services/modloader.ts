import AdmZip from 'adm-zip'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type {
  InstallKind,
  InstallProgress,
  InstallStage,
  LoaderType,
  LoaderVersionInfo
} from '@shared/types'
import { downloadFile } from '../utils/download'
import { ensureDir, readJson, writeJsonAtomic } from '../utils/fs'
import { fetchJson, request } from '../utils/http'
import { log } from '../utils/logger'
import { runPool } from '../utils/pool'
import type { JavaService } from './java'
import type { InstanceService } from './instances'
import type { InstalledService } from './minecraft/installed'
import { mavenPath, mavenUrl } from './minecraft/libraries'
import type { VersionJson } from './minecraft/types'

type ProgressEmitter = (progress: InstallProgress) => void

interface LoaderInstallResult {
  launchVersionId: string
  loaderVersion: string
}

interface MetaCacheEntry<T> {
  fetchedAt: number
  data: T
}

const CACHE_TTL = 30 * 60 * 1000

const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json'
const FORGE_PROMOTIONS =
  'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
const NEOFORGE_VERSIONS =
  'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
const NEOFORGE_METADATA =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml'

export class ModLoaderService {
  private readonly cache = new Map<string, MetaCacheEntry<unknown>>()

  constructor(
    private readonly java: JavaService,
    private readonly instances: InstanceService,
    private readonly installed: InstalledService,
    private readonly getCacheDirectory: () => string,
    private readonly emitProgress: ProgressEmitter
  ) {}

  async listVersions(
    loader: LoaderType,
    minecraftVersion: string
  ): Promise<LoaderVersionInfo[]> {
    if (loader === 'vanilla') return []

    switch (loader) {
      case 'fabric':
        return this.listFabric(minecraftVersion)
      case 'quilt':
        return this.listQuilt(minecraftVersion)
      case 'forge':
        return this.listForge(minecraftVersion)
      case 'neoforge':
        return this.listNeoForge(minecraftVersion)
      default:
        throw new Error('Неизвестный загрузчик.')
    }
  }

  async install(
    loader: Exclude<LoaderType, 'vanilla'>,
    minecraftVersion: string,
    loaderVersion: string,
    instanceId: string,
    context: { kind?: InstallKind; label?: string } = {}
  ): Promise<LoaderInstallResult> {
    if (!this.instances.exists(instanceId)) throw new Error('Инстанс не найден.')
    if (!loaderVersion.trim()) throw new Error('Не выбрана версия загрузчика.')

    if (loader === 'fabric' || loader === 'quilt') {
      return this.installMetaLoader(
        loader,
        minecraftVersion,
        loaderVersion.trim(),
        instanceId,
        context
      )
    }

    return this.installForgeLike(
      loader,
      minecraftVersion,
      loaderVersion.trim(),
      instanceId,
      context
    )
  }

  private async listFabric(minecraftVersion: string): Promise<LoaderVersionInfo[]> {
    const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}`
    const data = await this.cached(`fabric:${minecraftVersion}`, () =>
      fetchJson<Array<{ loader: { version: string; stable: boolean } }>>(url)
    )
    return data
      .map((entry) => ({ version: entry.loader.version, stable: entry.loader.stable }))
      .slice(0, 60)
  }

  private async listQuilt(minecraftVersion: string): Promise<LoaderVersionInfo[]> {
    const url = `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}`
    const data = await this.cached(`quilt:${minecraftVersion}`, () =>
      fetchJson<Array<{ loader: { version: string; stable?: boolean } }>>(url)
    )
    return data
      .map((entry) => ({
        version: entry.loader.version,
        stable: entry.loader.stable ?? !entry.loader.version.includes('beta')
      }))
      .slice(0, 60)
  }

  private async listForge(minecraftVersion: string): Promise<LoaderVersionInfo[]> {
    try {
      const data = await this.cached('forge:manifest', () =>
        fetchJson<Record<string, string[]>>(FORGE_METADATA)
      )
      const versions = data[minecraftVersion]
      if (!versions?.length) return []
      return versions
        .map((fullVersion) => {
          const version = fullVersion.startsWith(`${minecraftVersion}-`)
            ? fullVersion.slice(minecraftVersion.length + 1)
            : fullVersion
          return { version, stable: !version.includes('beta') }
        })
        .sort((a, b) => compareVersions(b.version, a.version))
        .slice(0, 80)
    } catch (error) {
      log.warn('loader', `Не удалось получить список Forge: ${String(error)}`)
      const promotions = await this.cached('forge:promotions', () =>
        fetchJson<{ promos: Record<string, string> }>(FORGE_PROMOTIONS)
      )
      const set = new Set<string>()
      for (const suffix of ['recommended', 'latest']) {
        const value = promotions.promos[`${minecraftVersion}-${suffix}`]
        if (value) set.add(value)
      }
      return [...set].map((version) => ({ version, stable: true }))
    }
  }

  private async listNeoForge(minecraftVersion: string): Promise<LoaderVersionInfo[]> {
    let versions: string[] = []
    try {
      const data = await this.cached('neoforge:versions', () =>
        fetchJson<{ versions: string[] }>(NEOFORGE_VERSIONS)
      )
      versions = data.versions ?? []
    } catch (error) {
      log.warn('loader', `Не удалось получить список NeoForge через API: ${String(error)}`)
      const response = await request(NEOFORGE_METADATA)
      const text = await response.text()
      if (!response.ok) throw new Error(`Не удалось получить список NeoForge (HTTP ${response.status}).`)
      versions = [...text.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1])
    }

    const prefix = neoForgePrefix(minecraftVersion)
    const legacyPrefix = `${minecraftVersion}-`
    return versions
      .map((fullVersion) => {
        if (fullVersion.startsWith(legacyPrefix)) {
          return {
            version: fullVersion.slice(legacyPrefix.length),
            stable: !fullVersion.includes('beta')
          }
        }
        if (fullVersion.startsWith(prefix)) {
          return { version: fullVersion, stable: !fullVersion.includes('beta') }
        }
        return null
      })
      .filter((entry): entry is LoaderVersionInfo => entry !== null)
      .sort((a, b) => compareVersions(b.version, a.version))
      .slice(0, 80)
  }

  private async installMetaLoader(
    loader: 'fabric' | 'quilt',
    minecraftVersion: string,
    loaderVersion: string,
    instanceId: string,
    context: { kind?: InstallKind; label?: string }
  ): Promise<LoaderInstallResult> {
    const taskId = `loader-${Date.now().toString(36)}`
    const baseUrl =
      loader === 'fabric'
        ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
        : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`

    this.progress(
      taskId,
      minecraftVersion,
      'loader',
      `Получаем профиль ${loader === 'fabric' ? 'Fabric' : 'Quilt'}…`,
      0,
      1,
      instanceId,
      context
    )
    const profile = await fetchJson<VersionJson>(baseUrl)
    if (
      !profile?.id ||
      !/^[A-Za-z0-9._+-]{1,128}$/.test(profile.id) ||
      !profile.mainClass
    ) {
      throw new Error('Meta-сервер загрузчика вернул некорректный профиль.')
    }
    profile.inheritsFrom = profile.inheritsFrom || minecraftVersion
    profile.type = profile.type || 'release'
    profile.releaseTime = profile.releaseTime || new Date().toISOString()
    profile.downloads = profile.downloads ?? {}

    const versionDirectory = this.installed.versionDirectory(profile.id, instanceId)
    ensureDir(versionDirectory)
    writeJsonAtomic(join(versionDirectory, `${profile.id}.json`), profile)

    const librariesDirectory = this.installed.librariesDirectory()
    const libraries = profile.libraries ?? []
    let downloaded = 0
    this.progress(
      taskId,
      minecraftVersion,
      'libraries',
      `Библиотеки загрузчика: 0 из ${libraries.length}`,
      0,
      Math.max(1, libraries.length),
      instanceId,
      context
    )

    await runPool(libraries, 6, async (library) => {
      const artifact = library.downloads?.artifact
      if (artifact) {
        await downloadFile(artifact.url, join(librariesDirectory, artifact.path ?? mavenPath(library.name)), {
          sha1: artifact.sha1,
          size: artifact.size
        })
      } else if (library.url) {
        const relative = mavenPath(library.name)
        await downloadFile(mavenUrl(library.url, library.name), join(librariesDirectory, relative))
      }
      downloaded += 1
      this.progress(
        taskId,
        minecraftVersion,
        'libraries',
        `Библиотеки загрузчика: ${downloaded} из ${libraries.length}`,
        downloaded,
        Math.max(1, libraries.length),
        instanceId,
        context
      )
    })

    this.progress(
      taskId,
      minecraftVersion,
      'loader',
      `Профиль ${profile.id} готов`,
      1,
      1,
      instanceId,
      context
    )
    log.info('loader', `Установлен ${loader} ${loaderVersion} для ${minecraftVersion} в ${instanceId}`)
    return { launchVersionId: profile.id, loaderVersion }
  }

  private async installForgeLike(
    loader: 'forge' | 'neoforge',
    minecraftVersion: string,
    loaderVersion: string,
    instanceId: string,
    context: { kind?: InstallKind; label?: string }
  ): Promise<LoaderInstallResult> {
    const taskId = `loader-${Date.now().toString(36)}`
    const minecraftDirectory = this.instances.minecraftDirectory(instanceId)
    const versionsDirectory = this.instances.versionsDirectory(instanceId)
    ensureDir(minecraftDirectory)
    ensureDir(versionsDirectory)

    const pair =
      loader === 'forge' ? `${minecraftVersion}-${loaderVersion}` : loaderVersion
    const installerUrl =
      loader === 'forge'
        ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(pair)}/forge-${encodeURIComponent(pair)}-installer.jar`
        : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(loaderVersion)}/neoforge-${encodeURIComponent(loaderVersion)}-installer.jar`

    const displayName = loader === 'forge' ? 'Forge' : 'NeoForge'
    const installerDirectory = join(this.getCacheDirectory(), 'installers')
    const installerPath = join(
      installerDirectory,
      `${loader}-${pair.replace(/[^A-Za-z0-9._+-]/g, '_')}-installer.jar`
    )

    this.progress(
      taskId,
      minecraftVersion,
      'loader',
      `Скачиваем установщик ${displayName}…`,
      0,
      1,
      instanceId,
      context
    )
    await downloadFile(installerUrl, installerPath)
    const expectedVersion = readInstallerVersion(installerPath)
    const before = new Set(existsSync(versionsDirectory) ? readdirSync(versionsDirectory) : [])

    this.writeLauncherProfiles(minecraftDirectory, minecraftVersion)

    const baseJson = readJson<VersionJson>(
      this.installed.versionJsonPath(minecraftVersion, instanceId)
    )
    const requiredJava = Math.max(8, baseJson?.javaVersion?.majorVersion ?? 8)
    const java = await this.java.resolve(requiredJava)

    this.progress(
      taskId,
      minecraftVersion,
      'loader',
      `Запускаем установщик ${displayName}…`,
      0,
      1,
      instanceId,
      context
    )

    await runInstaller(java.path, installerPath, minecraftDirectory, (line) => {
      const message = line.trim()
      if (message) {
        this.progress(
          taskId,
          minecraftVersion,
          'loader',
          `${displayName}: ${message.slice(0, 160)}`,
          0,
          1,
          instanceId,
          context
        )
      }
    })

    let generated = findGeneratedProfile(
      versionsDirectory,
      minecraftVersion,
      loader,
      before,
      expectedVersion
    )
    if (!generated) {
      generated = findGeneratedProfile(
        versionsDirectory,
        minecraftVersion,
        loader,
        new Set(),
        expectedVersion
      )
    }
    if (!generated) {
      throw new Error(
        `Установщик ${displayName} завершился, но профиль версии не найден. Проверьте лог.`
      )
    }

    this.progress(
      taskId,
      minecraftVersion,
      'loader',
      `${displayName} ${loaderVersion} установлен`,
      1,
      1,
      instanceId,
      context
    )
    log.info(
      'loader',
      `Установлен ${loader} ${loaderVersion} для ${minecraftVersion} в ${instanceId}: ${generated}`
    )
    return { launchVersionId: generated, loaderVersion }
  }

  private writeLauncherProfiles(minecraftDirectory: string, minecraftVersion: string): void {
    const now = new Date().toISOString()
    writeJsonAtomic(join(minecraftDirectory, 'launcher_profiles.json'), {
      profiles: {
        Cerberus: {
          name: 'Cerberus',
          type: 'custom',
          created: now,
          lastUsed: now,
          icon: 'data:image/png;base64,',
          lastVersionId: minecraftVersion
        }
      },
      settings: {},
      version: 3
    })
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const entry = this.cache.get(key) as MetaCacheEntry<T> | undefined
    if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.data
    const data = await loader()
    this.cache.set(key, { fetchedAt: Date.now(), data })
    return data
  }

  private progress(
    taskId: string,
    versionId: string,
    stage: InstallStage,
    message: string,
    current: number,
    total: number,
    instanceId: string,
    context: { kind?: InstallKind; label?: string }
  ): void {
    const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0
    this.emitProgress({
      taskId,
      versionId,
      stage,
      message,
      current,
      total,
      percent,
      instanceId,
      kind: context.kind ?? 'loader',
      label: context.label
    })
  }
}

export class ModLoaderRegistry {
  constructor(private readonly service: ModLoaderService) {}

  listVersions(loader: LoaderType, minecraftVersion: string): Promise<LoaderVersionInfo[]> {
    return this.service.listVersions(loader, minecraftVersion)
  }

  install(
    loader: Exclude<LoaderType, 'vanilla'>,
    minecraftVersion: string,
    loaderVersion: string,
    instanceId: string,
    context?: { kind?: InstallKind; label?: string }
  ): Promise<LoaderInstallResult> {
    return this.service.install(loader, minecraftVersion, loaderVersion, instanceId, context)
  }
}

function neoForgePrefix(minecraftVersion: string): string {
  const normalized = minecraftVersion.replace(/^1\./, '')
  const parts = normalized.split('.')
  if (parts.length >= 2) return `${parts[0]}.${parts[1] ?? '0'}.`
  return `${normalized}.`
}

function compareVersions(a: string, b: string): number {
  const tokenize = (value: string): Array<number | string> =>
    value
      .split(/[.+-]/)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part))
  const left = tokenize(a)
  const right = tokenize(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const l = left[index]
    const r = right[index]
    if (l === r) continue
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (typeof l === 'number' && typeof r === 'number') return l - r
    return String(l).localeCompare(String(r))
  }
  return 0
}

function readInstallerVersion(installerPath: string): string | null {
  try {
    const zip = new AdmZip(installerPath)
    for (const name of ['install_profile.json', 'version.json']) {
      const entry = zip.getEntry(name)
      if (!entry) continue
      const data = JSON.parse(entry.getData().toString('utf8')) as {
        version?: unknown
        id?: unknown
      }
      if (typeof data.version === 'string') return data.version
      if (typeof data.id === 'string') return data.id
    }
  } catch (error) {
    log.warn('loader', `Не удалось прочитать метаданные установщика: ${String(error)}`)
  }
  return null
}

function findGeneratedProfile(
  versionsDirectory: string,
  minecraftVersion: string,
  loader: 'forge' | 'neoforge',
  before: Set<string>,
  expectedVersion: string | null
): string | null {
  if (!existsSync(versionsDirectory)) return null
  const candidates: Array<{ id: string; mtime: number }> = []
  for (const entry of readdirSync(versionsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (before.has(entry.name)) continue
    if (expectedVersion && entry.name === expectedVersion) return entry.name
    const jsonPath = join(versionsDirectory, entry.name, `${entry.name}.json`)
    const profile = readJson<VersionJson>(jsonPath)
    if (!profile) continue
    const idLooksRight = entry.name.toLowerCase().includes(loader)
    if (profile.inheritsFrom === minecraftVersion || idLooksRight) {
      try {
        candidates.push({ id: entry.name, mtime: statSync(jsonPath).mtimeMs })
      } catch {
        candidates.push({ id: entry.name, mtime: 0 })
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0]?.id ?? null
}

async function runInstaller(
  javaPath: string,
  installerPath: string,
  workingDirectory: string,
  onLine: (line: string) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      javaPath,
      ['-jar', installerPath, '--installClient'],
      {
        cwd: workingDirectory,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )

    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Установщик загрузчика не завершился за 15 минут.'))
    }, 15 * 60 * 1000)

    let output = ''
    const consume = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output = `${output}${text}`.slice(-12000)
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) onLine(line)
      }
    }

    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(new Error(`Не удалось запустить установщик: ${error.message}`))
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      const tail = output.trim().split(/\r?\n/).slice(-8).join('\n')
      reject(
        new Error(
          `Установщик загрузчика завершился с кодом ${code ?? '—'}.${tail ? `\n${tail}` : ''}`
        )
      )
    })
  })
}
