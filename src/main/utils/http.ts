import { net } from 'electron'

export interface HttpRequestInit {
  method?: string
  headers?: Record<string, string>
  body?: string
  signal?: AbortSignal
}

interface HttpResponse {
  ok: boolean
  status: number
  statusText: string
  headers: { get(name: string): string | null }
  body: unknown
  text(): Promise<string>
  json(): Promise<unknown>
}

export class HttpError extends Error {
  readonly status: number
  readonly url: string
  readonly body: string
  readonly json?: unknown

  constructor(status: number, url: string, body: string, json?: unknown) {
    super(`HTTP ${status} для ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.body = body
    this.json = json
  }
}

const doFetch = net.fetch as unknown as (
  url: string,
  init?: HttpRequestInit
) => Promise<HttpResponse>

export async function request(url: string, init: HttpRequestInit = {}): Promise<HttpResponse> {
  return doFetch(url, {
    ...init,
    headers: {
      'User-Agent': 'CerberusLauncher/0.1.0',
      ...init.headers
    }
  })
}

export async function fetchJson<T>(url: string, init: HttpRequestInit = {}): Promise<T> {
  const response = await request(url, init)
  const text = await response.text()

  if (!response.ok) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = undefined
    }
    throw new HttpError(response.status, url, text, parsed)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Сервер вернул некорректный JSON: ${url}`)
  }
}

export async function postForm<T>(url: string, values: Record<string, string>): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams(values).toString()
  })
}

export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpError)) return undefined
  const body = error.json as { error?: unknown } | undefined
  return typeof body?.error === 'string' ? body.error : undefined
}
