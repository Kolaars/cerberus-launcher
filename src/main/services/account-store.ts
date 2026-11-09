import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type {
  Account,
  AccountsUpdateResult,
  AddOfflineAccountResult,
  MicrosoftDeviceCode,
  MicrosoftFlowError,
  MicrosoftFlowStatus,
  MicrosoftFlowSuccess
} from '@shared/types'
import { errorCode } from '../utils/http'
import { readJson, writeJsonAtomic } from '../utils/fs'
import { log } from '../utils/logger'
import { createAbortError, isAbortError, formatError } from '../utils/text'
import { offlineUuid, normalizeUuid } from '../utils/uuid'
import type { AppPaths } from './paths'
import type { ConfigStore } from './config-store'
import {
  authenticateWithXboxLive,
  pollDeviceCode,
  refreshMicrosoftToken,
  requestDeviceCode,
  skinUrlFromProfile,
  skinVariantFromProfile,
  type MicrosoftTokenResponse
} from './microsoft-auth'

const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/

interface StoredAccount extends Account {
  microsoftClientId?: string
  mcAccessTokenEnc?: string
  mcAccessTokenExpiresAt?: number
  refreshTokenEnc?: string
  xuid?: string
}

interface AccountsFile {
  version: 1
  activeAccountId: string | null
  accounts: StoredAccount[]
}

export interface MinecraftSession {
  accessToken: string
  uuid: string
  username: string
  userType: 'msa' | 'legacy'
  xuid?: string
  clientId?: string
}

export interface AccountEvents {
  onStatus(status: MicrosoftFlowStatus): void
  onSuccess(result: MicrosoftFlowSuccess): void
  onError(error: MicrosoftFlowError): void
}

interface MemoryToken {
  accessToken: string
  expiresAt: number
  xuid?: string
  clientId: string
}

export class AccountStore {
  private accounts: StoredAccount[] = []
  private activeAccountId: string | null = null
  private readonly flows = new Map<string, AbortController>()
  private readonly memoryTokens = new Map<string, MemoryToken>()

  constructor(
    private readonly paths: AppPaths,
    private readonly config: ConfigStore,
    private readonly events: AccountEvents
  ) {
    this.load()
  }

  list(): Account[] {
    return this.accounts.map((account) => this.toPublic(account))
  }

  getActiveAccountId(): string | null {
    return this.activeAccountId
  }

  getActiveAccount(): Account | null {
    const account = this.accounts.find((item) => item.id === this.activeAccountId)
    return account ? this.toPublic(account) : null
  }

  addOfflineAccount(username: string): AddOfflineAccountResult {
    const name = username.trim()
    if (!USERNAME_PATTERN.test(name)) {
      throw new Error('Ник должен содержать 3–16 символов: латиница, цифры и подчёркивание.')
    }

    const uuid = offlineUuid(name)
    const id = `offline:${uuid}`
    if (this.accounts.some((account) => account.id === id)) {
      throw new Error('Офлайн-аккаунт с таким ником уже добавлен.')
    }

    const account: StoredAccount = {
      id,
      type: 'offline',
      username: name,
      uuid,
      createdAt: Date.now()
    }

    this.accounts.push(account)
    this.activeAccountId = id
    this.save()
    log.info('accounts', `Добавлен офлайн-аккаунт ${name}`)

    return {
      account: this.toPublic(account),
      accounts: this.list(),
      activeAccountId: this.activeAccountId
    }
  }

  removeAccount(accountId: string): AccountsUpdateResult {
    const index = this.accounts.findIndex((account) => account.id === accountId)
    if (index < 0) throw new Error('Аккаунт не найден.')

    this.accounts.splice(index, 1)
    this.memoryTokens.delete(accountId)

    if (this.activeAccountId === accountId) {
      this.activeAccountId = this.accounts[0]?.id ?? null
    }

    this.save()
    return { accounts: this.list(), activeAccountId: this.activeAccountId }
  }

  setActiveAccount(accountId: string): AccountsUpdateResult {
    if (!this.accounts.some((account) => account.id === accountId)) {
      throw new Error('Аккаунт не найден.')
    }

    this.activeAccountId = accountId
    this.save()
    return { accounts: this.list(), activeAccountId: this.activeAccountId }
  }

  async startMicrosoftLogin(): Promise<MicrosoftDeviceCode> {
    const clientId = this.config.get().microsoftClientId.trim()
    if (!clientId) {
      throw new Error(
        'Сначала укажите Client ID приложения Microsoft в настройках. ' +
          'Инструкция — в docs/MICROSOFT_AUTH.md.'
      )
    }
    if (!CLIENT_ID_PATTERN.test(clientId)) {
      throw new Error('Client ID Microsoft должен быть в формате UUID.')
    }

    const device = await requestDeviceCode(clientId)
    const flowId = randomUUID()
    const controller = new AbortController()
    this.flows.set(flowId, controller)

    this.events.onStatus({
      flowId,
      phase: 'waiting',
      message: 'Ожидаем подтверждение входа в браузере.'
    })

    void this.completeMicrosoftLogin(flowId, clientId, device, controller.signal)

    return {
      flowId,
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000,
      message: device.message
    }
  }

  cancelMicrosoftLogin(flowId: string): boolean {
    const controller = this.flows.get(flowId)
    if (!controller) return false
    controller.abort(createAbortError('Вход отменён'))
    this.flows.delete(flowId)
    return true
  }

  dispose(): void {
    for (const controller of this.flows.values()) {
      controller.abort(createAbortError('Приложение закрывается'))
    }
    this.flows.clear()
  }

  async getSession(accountId: string): Promise<MinecraftSession> {
    const account = this.accounts.find((item) => item.id === accountId)
    if (!account) throw new Error('Аккаунт не найден.')

    if (account.type === 'offline') {
      return {
        accessToken: '0',
        uuid: account.uuid,
        username: account.username,
        userType: 'legacy'
      }
    }

    const memory = this.memoryTokens.get(account.id)
    if (memory && memory.expiresAt > Date.now() + 60_000) {
      return {
        accessToken: memory.accessToken,
        uuid: account.uuid,
        username: account.username,
        userType: 'msa',
        xuid: memory.xuid,
        clientId: memory.clientId
      }
    }

    const cachedAccessToken = this.decrypt(account.mcAccessTokenEnc)
    if (
      cachedAccessToken &&
      account.mcAccessTokenExpiresAt &&
      account.mcAccessTokenExpiresAt > Date.now() + 60_000
    ) {
      return {
        accessToken: cachedAccessToken,
        uuid: account.uuid,
        username: account.username,
        userType: 'msa',
        xuid: account.xuid,
        clientId: account.microsoftClientId
      }
    }

    return this.refreshSession(account)
  }

  private async completeMicrosoftLogin(
    flowId: string,
    clientId: string,
    device: Awaited<ReturnType<typeof requestDeviceCode>>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const token = await pollDeviceCode(clientId, device, signal, () => {
        this.events.onStatus({
          flowId,
          phase: 'waiting',
          message: 'Microsoft просит подождать. Продолжаем проверку…'
        })
      })

      this.events.onStatus({
        flowId,
        phase: 'authorizing',
        message: 'Входим в Xbox Live и Minecraft Services…'
      })

      const auth = await authenticateWithXboxLive(token.access_token)

      this.events.onStatus({
        flowId,
        phase: 'finishing',
        message: 'Сохраняем профиль…'
      })

      const account = this.upsertMicrosoftAccount(accountIdForProfile(auth.profile.id), clientId, token, auth)
      this.activeAccountId = account.id
      this.save()

      log.info('accounts', `Вход Microsoft выполнен: ${account.username}`)

      this.events.onSuccess({
        flowId,
        account: this.toPublic(account),
        accounts: this.list(),
        activeAccountId: this.activeAccountId
      })
    } catch (error) {
      if (isAbortError(error)) {
        log.info('accounts', 'Вход Microsoft отменён')
        return
      }

      log.error('accounts', error)
      this.events.onError({
        flowId,
        error: formatError(error),
        code: errorCode(error)
      })
    } finally {
      this.flows.delete(flowId)
    }
  }

  private async refreshSession(account: StoredAccount): Promise<MinecraftSession> {
    const refreshToken = this.decrypt(account.refreshTokenEnc)
    const clientId = account.microsoftClientId ?? this.config.get().microsoftClientId

    if (!refreshToken) {
      throw new Error('Сессия Microsoft истекла. Войдите в аккаунт заново.')
    }
    if (!clientId) {
      throw new Error('Для обновления сессии нужен Client ID Microsoft в настройках.')
    }

    log.info('accounts', `Обновляем сессию Microsoft для ${account.username}`)

    let token: MicrosoftTokenResponse
    try {
      token = await refreshMicrosoftToken(clientId, refreshToken)
    } catch (error) {
      if (errorCode(error) === 'invalid_grant' || errorCode(error) === 'invalid_request') {
        account.refreshTokenEnc = undefined
        account.mcAccessTokenEnc = undefined
        account.mcAccessTokenExpiresAt = undefined
        this.save()
        throw new Error('Сессия Microsoft истекла. Войдите в аккаунт заново.')
      }
      throw error
    }

    const auth = await authenticateWithXboxLive(token.access_token)
    const updated = this.upsertMicrosoftAccount(account.id, clientId, token, auth)
    this.save()

    return {
      accessToken: auth.accessToken,
      uuid: updated.uuid,
      username: updated.username,
      userType: 'msa',
      xuid: updated.xuid,
      clientId
    }
  }

  private upsertMicrosoftAccount(
    id: string,
    clientId: string,
    token: MicrosoftTokenResponse,
    auth: Awaited<ReturnType<typeof authenticateWithXboxLive>>
  ): StoredAccount {
    const existing = this.accounts.find((account) => account.id === id)
    const refreshToken = token.refresh_token ?? this.decrypt(existing?.refreshTokenEnc)
    const expiresAt = Date.now() + auth.expiresIn * 1000 - 60_000

    const account: StoredAccount = existing ?? {
      id,
      type: 'microsoft',
      username: auth.profile.name,
      uuid: auth.profile.id,
      createdAt: Date.now()
    }

    account.type = 'microsoft'
    account.username = auth.profile.name
    account.uuid = normalizeUuid(auth.profile.id)
    account.skinUrl = skinUrlFromProfile(auth.profile)
    account.skinVariant = skinVariantFromProfile(auth.profile)
    account.microsoftClientId = clientId
    account.xuid = auth.xuid
    account.mcAccessTokenExpiresAt = expiresAt

    const encryptedAccessToken = this.encrypt(auth.accessToken)
    if (encryptedAccessToken) account.mcAccessTokenEnc = encryptedAccessToken

    const encryptedRefreshToken = this.encrypt(refreshToken)
    if (encryptedRefreshToken) account.refreshTokenEnc = encryptedRefreshToken

    if (!existing) this.accounts.push(account)

    this.memoryTokens.set(account.id, {
      accessToken: auth.accessToken,
      expiresAt,
      xuid: auth.xuid,
      clientId
    })

    return account
  }

  private load(): void {
    const file = readJson<AccountsFile>(this.paths.accountsFile)
    if (!file || !Array.isArray(file.accounts)) {
      this.accounts = []
      this.activeAccountId = null
      return
    }

    this.accounts = file.accounts.filter(isStoredAccount)
    this.activeAccountId =
      file.activeAccountId && this.accounts.some((account) => account.id === file.activeAccountId)
        ? file.activeAccountId
        : (this.accounts[0]?.id ?? null)
  }

  private save(): void {
    const file: AccountsFile = {
      version: 1,
      activeAccountId: this.activeAccountId,
      accounts: this.accounts
    }
    writeJsonAtomic(this.paths.accountsFile, file)
  }

  private toPublic(account: StoredAccount): Account {
    return {
      id: account.id,
      type: account.type,
      username: account.username,
      uuid: account.uuid,
      skinUrl: account.skinUrl,
      skinVariant: account.skinVariant,
      createdAt: account.createdAt
    }
  }

  private encrypt(value?: string): string | undefined {
    if (!value) return undefined
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('accounts', 'Шифрование ОС недоступно — токен не будет сохранён на диск.')
      return undefined
    }
    return safeStorage.encryptString(value).toString('base64')
  }

  private decrypt(value?: string): string | undefined {
    if (!value || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'))
    } catch {
      log.warn('accounts', 'Не удалось расшифровать сохранённый токен.')
      return undefined
    }
  }
}

function accountIdForProfile(profileId: string): string {
  return `microsoft:${normalizeUuid(profileId)}`
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== 'object') return false
  const account = value as Partial<StoredAccount>
  return (
    typeof account.id === 'string' &&
    (account.type === 'microsoft' || account.type === 'offline') &&
    typeof account.username === 'string' &&
    typeof account.uuid === 'string' &&
    typeof account.createdAt === 'number'
  )
}
