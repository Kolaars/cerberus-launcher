import { isAbsolute } from 'node:path'
import type { Settings } from '@shared/types'
import { ensureDir, readJson, writeJsonAtomic } from '../utils/fs'
import { log } from '../utils/logger'
import type { AppPaths } from './paths'

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ConfigStore {
  private settings: Settings

  constructor(private readonly paths: AppPaths) {
    this.settings = this.load()
  }

  private defaults(): Settings {
    return {
      gameDirectory: this.paths.defaultGameDirectory,
      javaPath: null,
      memoryMb: 4096,
      showSnapshots: false,
      microsoftClientId: (process.env.CERBERUS_MS_CLIENT_ID ?? '').trim(),
      jvmArgs: '',
      uiMode: 'classic',
      curseForgeApiKey: (process.env.CERBERUS_CURSEFORGE_API_KEY ?? '').trim()
    }
  }

  private load(): Settings {
    const stored = readJson<Partial<Settings>>(this.paths.settingsFile)
    const defaults = this.defaults()
    if (!stored || typeof stored !== 'object') return defaults

    const merged: Settings = { ...defaults, ...stored }

    try {
      ensureDir(merged.gameDirectory)
    } catch (error) {
      log.warn('config', `Не удалось создать игровую папку, использую стандартную: ${String(error)}`)
      merged.gameDirectory = defaults.gameDirectory
      ensureDir(merged.gameDirectory)
    }

    return merged
  }

  get(): Settings {
    return { ...this.settings }
  }

  update(patch: Partial<Settings>): Settings {
    const next: Settings = { ...this.settings, ...patch }

    next.gameDirectory = String(next.gameDirectory ?? '').trim()
    if (!next.gameDirectory || !isAbsolute(next.gameDirectory)) {
      throw new Error('Папка игры должна быть указана абсолютным путём.')
    }

    next.memoryMb = Number(next.memoryMb)
    if (!Number.isFinite(next.memoryMb) || next.memoryMb < 1024 || next.memoryMb > 32768) {
      throw new Error('Объём памяти должен быть от 1024 до 32768 МБ.')
    }
    next.memoryMb = Math.round(next.memoryMb / 256) * 256

    next.javaPath = next.javaPath?.trim() ? next.javaPath.trim() : null
    if (next.javaPath && !isAbsolute(next.javaPath)) {
      throw new Error('Путь к Java должен быть абсолютным.')
    }

    next.microsoftClientId = String(next.microsoftClientId ?? '').trim()
    if (next.microsoftClientId && !CLIENT_ID_PATTERN.test(next.microsoftClientId)) {
      throw new Error('Client ID Microsoft должен быть в формате UUID.')
    }

    next.jvmArgs = String(next.jvmArgs ?? '').trim()
    if (next.jvmArgs.length > 4000) {
      throw new Error('Дополнительные JVM-аргументы слишком длинные.')
    }

    next.showSnapshots = Boolean(next.showSnapshots)

    next.uiMode = next.uiMode === 'prism' ? 'prism' : 'classic'

    next.curseForgeApiKey = String(next.curseForgeApiKey ?? '').trim()
    if (next.curseForgeApiKey.length > 256) {
      throw new Error('API-ключ CurseForge слишком длинный.')
    }

    ensureDir(next.gameDirectory)
    this.settings = next
    writeJsonAtomic(this.paths.settingsFile, this.settings)
    log.info('config', 'Настройки сохранены')
    return this.get()
  }
}
