import AdmZip from 'adm-zip'
import { resolve, sep, dirname, join } from 'node:path'
import { rm, writeFile } from 'node:fs/promises'
import { ensureDir } from '../../utils/fs'
import type { ResolvedNative } from './types'

export async function prepareNatives(
  nativesDirectory: string,
  natives: ResolvedNative[],
  report: (current: number, total: number, message: string) => void
): Promise<void> {
  await rm(nativesDirectory, { recursive: true, force: true })
  ensureDir(nativesDirectory)

  for (const subdirectory of ['java', 'jna', 'lwjgl', 'netty']) {
    ensureDir(join(nativesDirectory, subdirectory))
  }

  if (natives.length === 0) {
    report(1, 1, 'Нативные библиотеки не требуются')
    return
  }

  let extracted = 0
  for (const native of natives) {
    await extractNative(native, nativesDirectory)
    extracted += 1
    report(extracted, natives.length, `Распаковка нативов: ${extracted} из ${natives.length}`)
  }
}

async function extractNative(
  native: ResolvedNative,
  nativesDirectory: string
): Promise<void> {
  const zip = new AdmZip(native.path)
  const root = resolve(nativesDirectory)

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue

    const entryName = entry.entryName.replace(/\\/g, '/')
    if (entryName.startsWith('META-INF/')) continue
    if (isExcluded(entryName, native.exclude)) continue

    const target = resolve(root, entryName)
    if (target !== root && !target.startsWith(`${root}${sep}`)) continue

    ensureDir(dirname(target))
    await writeFile(target, entry.getData())
  }
}

function isExcluded(entryName: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern).test(entryName)) return true
    } catch {
      if (entryName.startsWith(pattern)) return true
    }
  }
  return false
}
