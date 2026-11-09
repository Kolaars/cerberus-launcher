import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readJson } from '../../utils/fs'
import type { Library, VersionArgument, VersionJson } from './types'

export interface ResolvedProfile {
  version: VersionJson
  chain: ResolvedProfileEntry[]
  clientJarPath: string
  baseVersionId: string
  /** Папка версии, в которой лежит итоговый профиль (для нативов). */
  versionDirectory: string
}

export interface ResolvedProfileEntry {
  id: string
  version: VersionJson
  directory: string
}

/**
 * Загружает профиль версии с поддержкой inheritsFrom. Родительские профили
 * ищутся сначала в папке инстанса, затем в общем каталоге версий.
 */
export function resolveVersionProfile(
  versionId: string,
  primaryVersionsDirectory: string,
  fallbackVersionsDirectories: string[] = []
): ResolvedProfile {
  const searched = [primaryVersionsDirectory, ...fallbackVersionsDirectories]
  const chain: ResolvedProfileEntry[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = versionId

  while (currentId) {
    if (visited.has(currentId)) {
      throw new Error(`Циклическое наследование версии ${currentId}.`)
    }
    visited.add(currentId)

    const found = findVersion(currentId, searched)
    if (!found) {
      throw new Error(
        currentId === versionId
          ? `Профиль версии ${versionId} не найден. Переустановите инстанс.`
          : `Не найден родительский профиль ${currentId}. Переустановите версию Minecraft.`
      )
    }
    chain.push(found)
    currentId = found.version.inheritsFrom
  }

  if (chain.length === 0) {
    throw new Error(`Профиль версии ${versionId} пуст.`)
  }

  const merged = chain.reduce<VersionJson | null>(
    (parent, entry) => mergeProfiles(parent, entry.version),
    null
  )
  if (!merged || !merged.mainClass) {
    throw new Error('В профиле версии отсутствует главный класс запуска.')
  }

  const base = [...chain].reverse().find((entry) => existsSync(join(entry.directory, `${entry.id}.jar`)))
  const jarHint = merged.jar
  const hinted = jarHint ? chain.find((entry) => entry.id === jarHint) : undefined
  const clientJarPath = hinted
    ? join(hinted.directory, `${hinted.id}.jar`)
    : base
      ? join(base.directory, `${base.id}.jar`)
      : join(chain[chain.length - 1].directory, `${chain[chain.length - 1].id}.jar`)

  if (!existsSync(clientJarPath)) {
    throw new Error('Клиентский JAR не найден. Переустановите инстанс.')
  }

  return {
    version: merged,
    chain,
    clientJarPath,
    baseVersionId: base?.id ?? chain[chain.length - 1].id,
    versionDirectory: chain[0].directory
  }
}

function findVersion(
  versionId: string,
  directories: string[]
): ResolvedProfileEntry | null {
  for (const directory of directories) {
    const jsonPath = join(directory, versionId, `${versionId}.json`)
    const version = readJson<VersionJson>(jsonPath)
    if (version && version.id) {
      return {
        id: versionId,
        version,
        directory: join(directory, versionId)
      }
    }
  }
  return null
}

function mergeProfiles(parent: VersionJson | null, child: VersionJson): VersionJson {
  if (!parent) {
    return {
      ...child,
      libraries: dedupeLibraries(child.libraries ?? []),
      arguments: child.arguments
        ? {
            jvm: [...child.arguments.jvm],
            game: [...child.arguments.game]
          }
        : undefined
    }
  }

  return {
    id: child.id || parent.id,
    type: child.type || parent.type,
    mainClass: child.mainClass || parent.mainClass,
    assets: child.assets ?? parent.assets,
    assetIndex: child.assetIndex ?? parent.assetIndex,
    downloads: {
      ...parent.downloads,
      ...child.downloads
    },
    javaVersion: child.javaVersion ?? parent.javaVersion,
    libraries: dedupeLibraries([...(parent.libraries ?? []), ...(child.libraries ?? [])]),
    arguments:
      parent.arguments || child.arguments
        ? {
            jvm: mergeArguments(parent.arguments?.jvm, child.arguments?.jvm),
            game: mergeArguments(parent.arguments?.game, child.arguments?.game)
          }
        : undefined,
    minecraftArguments: child.minecraftArguments ?? parent.minecraftArguments,
    logging: child.logging ?? parent.logging,
    releaseTime: child.releaseTime || parent.releaseTime,
    minimumLauncherVersion:
      child.minimumLauncherVersion ?? parent.minimumLauncherVersion,
    complianceLevel: child.complianceLevel ?? parent.complianceLevel,
    inheritsFrom: undefined,
    jar: child.jar ?? parent.jar
  }
}

function mergeArguments(
  parent: VersionArgument[] | undefined,
  child: VersionArgument[] | undefined
): VersionArgument[] {
  return [...(parent ?? []), ...(child ?? [])]
}

function dedupeLibraries(libraries: Library[]): Library[] {
  const map = new Map<string, Library>()
  for (const library of libraries) {
    map.set(libraryKey(library.name), library)
  }
  return [...map.values()]
}

function libraryKey(name: string): string {
  const [group, artifact, version, classifier] = name.split(':')
  return `${group}:${artifact}:${classifier ?? version}`
}
