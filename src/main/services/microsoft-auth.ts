import { HttpError, errorCode, fetchJson, postForm } from '../utils/http'
import { sleep } from '../utils/text'

const DEVICE_CODE_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'
const TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'
const SCOPE = 'XboxLive.signin offline_access'

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
  message: string
}

export interface MicrosoftTokenResponse {
  token_type: string
  scope: string
  expires_in: number
  access_token: string
  refresh_token?: string
}

interface XboxResponse {
  Token: string
  DisplayClaims?: {
    xui?: Array<{ uhs?: string; xid?: string }>
  }
}

export interface MinecraftProfile {
  id: string
  name: string
  skins?: Array<{
    id?: string
    state?: string
    url?: string
    variant?: string
  }>
}

export interface MinecraftAuthResult {
  accessToken: string
  expiresIn: number
  profile: MinecraftProfile
  xuid?: string
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCodeResponse> {
  return postForm<DeviceCodeResponse>(DEVICE_CODE_URL, {
    client_id: clientId,
    scope: SCOPE
  })
}

export async function pollDeviceCode(
  clientId: string,
  device: DeviceCodeResponse,
  signal: AbortSignal,
  onSlowDown?: () => void
): Promise<MicrosoftTokenResponse> {
  let interval = Math.max(1, device.interval || 5)
  const expiresAt = Date.now() + device.expires_in * 1000

  while (Date.now() < expiresAt) {
    await sleep(interval * 1000, signal)

    try {
      return await postForm<MicrosoftTokenResponse>(TOKEN_URL, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: device.device_code
      })
    } catch (error) {
      const code = errorCode(error)

      if (code === 'authorization_pending') continue
      if (code === 'slow_down') {
        interval += 5
        onSlowDown?.()
        continue
      }
      if (code === 'expired_token') {
        throw new Error('Код входа истёк. Начните вход заново.')
      }
      if (code === 'authorization_declined') {
        throw new Error('Вход отклонён на странице Microsoft.')
      }
      if (code === 'bad_verification_code') {
        throw new Error('Microsoft не принял код устройства. Попробуйте снова.')
      }

      if (error instanceof HttpError && (error.status === 429 || error.status >= 500)) {
        continue
      }

      throw error
    }
  }

  throw new Error('Время ожидания входа истекло. Начните заново.')
}

export async function refreshMicrosoftToken(
  clientId: string,
  refreshToken: string
): Promise<MicrosoftTokenResponse> {
  return postForm<MicrosoftTokenResponse>(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE
  })
}

export async function authenticateWithXboxLive(
  microsoftAccessToken: string
): Promise<MinecraftAuthResult> {
  const xbl = await fetchJson<XboxResponse>(XBL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'https://login.live.com',
        RpsTicket: `d=${microsoftAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    })
  })

  const xuid = xbl.DisplayClaims?.xui?.[0]?.xid

  let xsts: XboxResponse
  try {
    xsts = await fetchJson<XboxResponse>(XSTS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        Properties: {
          SandboxId: 'RETAIL',
          UserTokens: [xbl.Token]
        },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      })
    })
  } catch (error) {
    if (error instanceof HttpError) {
      const body = error.json as { XErr?: number } | undefined
      throw new Error(translateXstsError(body?.XErr))
    }
    throw error
  }

  const uhs = xsts.DisplayClaims?.xui?.[0]?.uhs
  if (!uhs) {
    throw new Error('Xbox Live не вернул идентификатор пользователя.')
  }

  const minecraft = await fetchJson<{ access_token: string; expires_in: number }>(MC_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`
    })
  })

  let profile: MinecraftProfile
  try {
    profile = await fetchJson<MinecraftProfile>(MC_PROFILE_URL, {
      headers: { Authorization: `Bearer ${minecraft.access_token}` }
    })
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      throw new Error('У этого аккаунта нет лицензии Minecraft: Java Edition.')
    }
    throw error
  }

  return {
    accessToken: minecraft.access_token,
    expiresIn: minecraft.expires_in,
    profile,
    xuid
  }
}

export function skinUrlFromProfile(profile: MinecraftProfile): string | undefined {
  const skin = profile.skins?.find((item) => item.state === 'ACTIVE') ?? profile.skins?.[0]
  return skin?.url?.replace(/^http:/, 'https:')
}

export function skinVariantFromProfile(profile: MinecraftProfile): 'classic' | 'slim' {
  const skin = profile.skins?.find((item) => item.state === 'ACTIVE') ?? profile.skins?.[0]
  return skin?.variant?.toUpperCase() === 'SLIM' ? 'slim' : 'classic'
}

function translateXstsError(code?: number): string {
  switch (code) {
    case 2148916233:
      return 'У аккаунта Microsoft нет профиля Xbox. Создайте его на xbox.com и попробуйте снова.'
    case 2148916235:
      return 'Xbox Live недоступен в регионе этого аккаунта.'
    case 2148916236:
    case 2148916237:
      return 'Аккаунту нужна проверка возраста (взрослый аккаунт).'
    case 2148916238:
      return 'Детский аккаунт должен быть добавлен в семейную группу Microsoft.'
    default:
      return 'Не удалось авторизоваться в Xbox Live. Попробуйте позже.'
  }
}
