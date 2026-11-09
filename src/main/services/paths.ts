import { app } from 'electron'
import { join } from 'node:path'
import { ensureDir } from '../utils/fs'

export class AppPaths {
  readonly dataDirectory: string
  readonly logsDirectory: string
  readonly cacheDirectory: string
  readonly settingsFile: string
  readonly accountsFile: string
  readonly defaultGameDirectory: string

  constructor() {
    this.dataDirectory = app.getPath('userData')
    this.logsDirectory = join(this.dataDirectory, 'logs')
    this.cacheDirectory = join(this.dataDirectory, 'cache')
    this.settingsFile = join(this.dataDirectory, 'settings.json')
    this.accountsFile = join(this.dataDirectory, 'accounts.json')
    this.defaultGameDirectory = join(app.getPath('home'), '.cerberus')

    ensureDir(this.dataDirectory)
    ensureDir(this.logsDirectory)
    ensureDir(this.cacheDirectory)
  }
}
