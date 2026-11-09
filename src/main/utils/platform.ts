import os from 'node:os'

export type RuleOsName = 'windows' | 'osx' | 'linux'

export function currentOsName(): RuleOsName {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

export function currentArch(): string {
  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'ia32') return 'x86'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

export function currentOsVersion(): string {
  return os.release()
}

export function javaExecutableName(): string {
  return process.platform === 'win32' ? 'java.exe' : 'java'
}
