import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

type LogLevel = 'INFO' | 'WARN' | 'ERROR'

let logFile: string | null = null

export function initLogger(directory: string): void {
  mkdirSync(directory, { recursive: true })
  logFile = join(directory, 'launcher.log')

  try {
    if (statSync(logFile).size > 5 * 1024 * 1024) {
      renameSync(logFile, join(directory, 'launcher.old.log'))
    }
  } catch {
    // Log file does not exist yet.
  }
}

function write(level: LogLevel, scope: string, message: string): void {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${message}`
  const consoleMethod = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log
  consoleMethod(line)

  if (!logFile) return
  try {
    appendFileSync(logFile, `${line}\n`, 'utf8')
  } catch {
    // Logging must never break the launcher.
  }
}

export const log = {
  info(scope: string, message: string): void {
    write('INFO', scope, message)
  },
  warn(scope: string, message: string): void {
    write('WARN', scope, message)
  },
  error(scope: string, error: unknown): void {
    write('ERROR', scope, error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
  }
}
