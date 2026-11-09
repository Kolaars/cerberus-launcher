import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { JavaInfo } from '@shared/types'
import { javaExecutableName } from '../utils/platform'
import { log } from '../utils/logger'
import type { ConfigStore } from './config-store'

const execFileAsync = promisify(execFile)

export class JavaService {
  constructor(private readonly config: ConfigStore) {}

  async detect(): Promise<JavaInfo[]> {
    const candidates = await this.collectCandidates()
    const seen = new Set<string>()
    const result: JavaInfo[] = []

    for (const candidate of candidates) {
      const normalized = candidate.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)

      const info = await this.probe(candidate)
      if (info) result.push(info)
    }

    result.sort((a, b) => b.major - a.major)
    return result
  }

  async resolve(requiredMajor: number): Promise<JavaInfo> {
    const configured = this.config.get().javaPath
    const normalizedConfigured = configured ? this.normalizeExecutable(configured) : null
    const detected = await this.detect()

    if (configured) {
      const configuredInfo = detected.find(
        (item) => item.path.toLowerCase() === normalizedConfigured?.toLowerCase()
      )

      if (!configuredInfo) {
        throw new Error(
          `Указанная Java не найдена или не запускается: ${configured}. Проверьте путь в настройках.`
        )
      }

      if (configuredInfo.major < requiredMajor) {
        throw new Error(
          `Для этой версии нужна Java ${requiredMajor}+, а выбрана Java ${configuredInfo.major}. ` +
            'Укажите более новую Java в настройках.'
        )
      }

      if (configuredInfo.major > requiredMajor) {
        log.warn(
          'java',
          `Версия требует Java ${requiredMajor}, используется Java ${configuredInfo.major}. Возможна несовместимость.`
        )
      }

      return configuredInfo
    }

    const suitable = detected.find((item) => item.major >= requiredMajor)
    if (!suitable) {
      const found = detected.length
        ? `Найдены версии: ${detected.map((item) => item.major).join(', ')}.`
        : 'Java не найдена в системе.'
      throw new Error(
        `Для запуска нужна Java ${requiredMajor}+. ${found} ` +
          'Установите Java или укажите путь к java.exe в настройках.'
      )
    }

    // Oracle javapath/java.exe — это прокси, который запускает настоящую JVM
    // дочерним процессом. Предпочитаем прямой путь к JDK, если он найден.
    const direct = detected.find(
      (item) => item.major >= requiredMajor && !isJavaPathProxy(item.path)
    )
    return direct ?? suitable
  }

  private async collectCandidates(): Promise<string[]> {
    const candidates: string[] = []
    const configured = this.config.get().javaPath
    if (configured) candidates.push(this.normalizeExecutable(configured))

    for (const envName of ['JAVA_HOME', 'JDK_HOME'] as const) {
      const root = process.env[envName]
      if (root) candidates.push(join(root, 'bin', javaExecutableName()))
    }

    try {
      const command = process.platform === 'win32' ? 'where.exe' : 'which'
      const args = process.platform === 'win32' ? ['java'] : ['java']
      const { stdout } = await execFileAsync(command, args, { windowsHide: true, timeout: 5000 })
      for (const line of stdout.split(/\r?\n/)) {
        const value = line.trim()
        if (value) candidates.push(value)
      }
    } catch {
      // Java may not be on PATH.
    }

    if (process.platform === 'win32') {
      candidates.push(...this.scanWindowsJavaRoots())
    }

    return candidates.filter((candidate) => {
      try {
        return statSync(candidate).isFile()
      } catch {
        return false
      }
    })
  }

  private normalizeExecutable(path: string): string {
    try {
      if (statSync(path).isDirectory()) {
        return join(path, 'bin', javaExecutableName())
      }
    } catch {
      // Let the probe report the problem.
    }
    return path
  }

  private scanWindowsJavaRoots(): string[] {
    const roots = [
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Java'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Eclipse Adoptium'),
      join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft'),
      join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Java')
    ]

    const result: string[] = []
    for (const root of roots) {
      if (!existsSync(root)) continue
      try {
        for (const entry of readdirSync(root)) {
          const candidate = join(root, entry, 'bin', javaExecutableName())
          if (existsSync(candidate)) result.push(candidate)
        }
      } catch {
        // Ignore unreadable directories.
      }
    }
    return result
  }

  private async probe(path: string): Promise<JavaInfo | null> {
    try {
      const { stdout, stderr } = await execFileAsync(path, ['-version'], {
        windowsHide: true,
        timeout: 8000,
        maxBuffer: 1024 * 1024
      })
      return this.parseVersion(path, `${stdout}\n${stderr}`)
    } catch (error) {
      const output =
        error && typeof error === 'object' && 'stderr' in error
          ? String((error as { stderr?: string }).stderr ?? '')
          : ''
      return output ? this.parseVersion(path, output) : null
    }
  }

  private parseVersion(path: string, output: string): JavaInfo | null {
    const versionMatch = output.match(/version "([^"]+)"/)
    if (!versionMatch) return null

    const version = versionMatch[1]
    const majorMatch = version.match(/^(?:1\.)?(\d+)/)
    if (!majorMatch) return null

    return { path, version, major: Number(majorMatch[1]) }
  }
}

function isJavaPathProxy(path: string): boolean {
  return /[\\/]common files[\\/]oracle[\\/]java[\\/]javapath[\\/]/i.test(path)
}
