import type { LoaderType } from '@shared/types'

export interface DownloadInfo {
  path?: string
  sha1: string
  size: number
  url: string
}

export interface ManifestVersion {
  id: string
  type: string
  url: string
  time: string
  releaseTime: string
  sha1?: string
  complianceLevel?: number
}

export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: ManifestVersion[]
}

export interface RuleOs {
  name?: string
  arch?: string
  version?: string
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: RuleOs
  features?: Record<string, boolean>
}

export type VersionArgument =
  | string
  | {
      rules?: Rule[]
      value: string | string[]
    }

export interface Library {
  name: string
  rules?: Rule[]
  downloads?: {
    artifact?: DownloadInfo
    classifiers?: Record<string, DownloadInfo>
  }
  natives?: Record<string, string>
  extract?: {
    exclude?: string[]
  }
  /** Maven base URL для профилей загрузчиков без готового artifact. */
  url?: string
}

export interface AssetObject {
  hash: string
  size: number
}

export interface AssetIndexFile {
  objects: Record<string, AssetObject>
  virtual?: boolean
  map_to_resources?: boolean
}

export interface AssetIndexInfo extends DownloadInfo {
  id: string
  totalSize: number
}

export interface LoggingConfig {
  argument: string
  file: DownloadInfo & { id: string }
  type: string
}

export interface VersionJson {
  id: string
  type: string
  mainClass: string
  assets?: string
  assetIndex?: AssetIndexInfo
  downloads?: {
    client?: DownloadInfo
    server?: DownloadInfo
  }
  javaVersion?: {
    component: string
    majorVersion: number
  }
  libraries: Library[]
  arguments?: {
    game: VersionArgument[]
    jvm: VersionArgument[]
  }
  minecraftArguments?: string
  logging?: {
    client?: LoggingConfig
  }
  releaseTime: string
  minimumLauncherVersion?: number
  complianceLevel?: number
  inheritsFrom?: string
  jar?: string
}

export interface InstallMarker {
  version: 1
  id: string
  type: string
  releaseTime: string
  installedAt: number
  loader: LoaderType
}

export interface ResolvedLibrary {
  name: string
  path: string
  url: string
  sha1: string
  size: number
  native: boolean
}

export interface ResolvedNative {
  name: string
  path: string
  url: string
  sha1: string
  size: number
  exclude: string[]
}
