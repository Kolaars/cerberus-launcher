import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'

export function ensureDir(directory: string): void {
  mkdirSync(directory, { recursive: true })
}

export function pathExists(path: string): boolean {
  return existsSync(path)
}

export function fileSize(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

export function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  ensureDir(dirname(path))
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    renameSync(tempPath, path)
  } catch {
    rmSync(path, { force: true })
    renameSync(tempPath, path)
  }
}

export function removePath(path: string): void {
  rmSync(path, { recursive: true, force: true })
}
