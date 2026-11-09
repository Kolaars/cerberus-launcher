import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Library,
  ResolvedLibrary,
  ResolvedNative,
  VersionJson
} from './types'
import type { RuleContext } from './rules'
import { rulesAllow } from './rules'

interface NativeCandidate {
  library: ResolvedLibrary
  base: string
  score: number
}

export interface ResolvedLibraries {
  classpath: ResolvedLibrary[]
  natives: ResolvedNative[]
}

/**
 * Разрешает библиотеки профиля. Поддерживает несколько корней: изолированный
 * инстанс и общий кэш. Уже существующий файл имеет приоритет, иначе используется
 * первый корень.
 */
export function resolveLibraries(
  version: VersionJson,
  context: RuleContext,
  librariesDirectories: string | string[]
): ResolvedLibraries {
  const roots = Array.isArray(librariesDirectories)
    ? librariesDirectories
    : [librariesDirectories]
  const classpath: ResolvedLibrary[] = []
  const natives: ResolvedNative[] = []
  const nativeCandidates: NativeCandidate[] = []

  for (const library of version.libraries ?? []) {
    if (!rulesAllow(library.rules, context)) continue

    const artifact = library.downloads?.artifact
    const relativePath = artifact?.path ?? mavenPath(library.name)

    if (artifact || library.url) {
      const resolved: ResolvedLibrary = {
        name: library.name,
        path: chooseLibraryPath(roots, relativePath),
        url: artifact?.url ?? mavenUrl(library.url, library.name),
        sha1: artifact?.sha1 ?? '',
        size: artifact?.size ?? 0,
        native: isNativeClassifier(library.name)
      }

      if (resolved.native) {
        const score = nativeClassifierScore(library.name, context)
        if (score > 0) {
          nativeCandidates.push({
            library: resolved,
            base: libraryBaseName(library.name),
            score
          })
        }
      } else {
        classpath.push(resolved)
      }
    }

    const legacy = legacyNative(library, context, roots)
    if (legacy) natives.push(legacy)
  }

  const bestNatives = new Map<string, NativeCandidate>()
  for (const candidate of nativeCandidates) {
    const current = bestNatives.get(candidate.base)
    if (!current || candidate.score > current.score) {
      bestNatives.set(candidate.base, candidate)
    }
  }
  for (const candidate of bestNatives.values()) {
    classpath.push(candidate.library)
  }

  return { classpath, natives }
}

export function libraryPath(
  librariesDirectory: string,
  library: Library
): string | null {
  const artifact = library.downloads?.artifact
  if (artifact) {
    return join(librariesDirectory, artifact.path ?? mavenPath(library.name))
  }
  if (library.url) return join(librariesDirectory, mavenPath(library.name))
  return null
}

export function mavenPath(name: string): string {
  const [group, artifact, version, classifier] = name.split(':')
  const file = classifier
    ? `${artifact}-${version}-${classifier}.jar`
    : `${artifact}-${version}.jar`
  return join(group.replace(/\./g, '/'), artifact, version, file)
}

export function mavenUrl(base: string | undefined, name: string): string {
  const root = base ?? 'https://libraries.minecraft.net/'
  const normalized = root.endsWith('/') ? root : `${root}/`
  return `${normalized}${mavenPath(name).replace(/\\/g, '/')}`
}

function chooseLibraryPath(roots: string[], relativePath: string): string {
  for (const root of roots) {
    const candidate = join(root, relativePath)
    if (existsSync(candidate)) return candidate
  }
  return join(roots[0], relativePath)
}

function legacyNative(
  library: Library,
  context: RuleContext,
  roots: string[]
): ResolvedNative | null {
  const pattern = library.natives?.[context.osName]
  if (!pattern) return null

  const archToken =
    context.arch === 'x86' ? '32' : context.arch === 'x86_64' ? '64' : context.arch
  const classifier = pattern.replace('${arch}', archToken)
  const download = library.downloads?.classifiers?.[classifier]
  if (!download) return null

  const relativePath = download.path ?? mavenPath(`${library.name}:${classifier}`)
  return {
    name: `${library.name}:${classifier}`,
    path: chooseLibraryPath(roots, relativePath),
    url: download.url,
    sha1: download.sha1,
    size: download.size,
    exclude: library.extract?.exclude ?? []
  }
}

function isNativeClassifier(name: string): boolean {
  const classifier = name.split(':')[3]
  return Boolean(classifier?.startsWith('natives-'))
}

function libraryBaseName(name: string): string {
  return name.split(':').slice(0, 3).join(':')
}

/**
 * 0 — несовместимо, 1 — универсальный вариант для ОС, 2 — точное совпадение архитектуры.
 */
function nativeClassifierScore(name: string, context: RuleContext): number {
  const classifier = name.split(':')[3] ?? ''
  const rest = classifier.replace(/^natives-/, '')

  const osPart =
    rest.startsWith('macos') || rest.startsWith('osx')
      ? 'osx'
      : rest.startsWith('windows')
        ? 'windows'
        : rest.startsWith('linux')
          ? 'linux'
          : rest

  if (osPart !== context.osName) return 0

  const hasArm64 = /(?:^|-)arm64$/i.test(rest)
  const hasX64 = /(?:^|-)(?:x86_64|x64)$/i.test(rest)
  const hasX86 = /(?:^|-)(?:x86|i386|i686)$/i.test(rest)

  if (hasArm64) return context.arch === 'arm64' ? 2 : 0
  if (hasX64) return context.arch === 'x86_64' ? 2 : 0
  if (hasX86) return context.arch === 'x86' ? 2 : 0

  return 1
}
