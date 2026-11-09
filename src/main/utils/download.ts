import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { fileSize } from '../utils/fs'
import { HttpError, request } from '../utils/http'
import { createAbortError, isAbortError, sleep } from '../utils/text'

export interface DownloadOptions {
  sha1?: string
  size?: number
  signal?: AbortSignal
  onProgress?: (received: number, total: number) => void
}

export type DownloadResult = 'downloaded' | 'skipped'

/**
 * Скачивает файл во временный `.part`, проверяет SHA-1 и только потом
 * переименовывает в целевой путь. Уже скачанные файлы пропускаются.
 */
export async function downloadFile(
  url: string,
  destination: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  const existingSize = fileSize(destination)
  if (existingSize !== null && (options.size === undefined || existingSize === options.size)) {
    return 'skipped'
  }

  await mkdir(dirname(destination), { recursive: true })
  if (existingSize !== null) await rm(destination, { force: true })

  const partPath = `${destination}.part`
  let lastError: unknown

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (options.signal?.aborted) throw options.signal.reason ?? createAbortError('Загрузка отменена')
    await rm(partPath, { force: true })

    try {
      await downloadAttempt(url, partPath, options)
      await rm(destination, { force: true })
      await rename(partPath, destination)
      return 'downloaded'
    } catch (error) {
      lastError = error
      await rm(partPath, { force: true })

      if (options.signal?.aborted || isAbortError(error)) throw error
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) throw error
      if (attempt === 3) break

      await sleep(500 * attempt, options.signal)
    }
  }

  throw lastError
}

async function downloadAttempt(
  url: string,
  partPath: string,
  options: DownloadOptions
): Promise<void> {
  const response = await request(url, { signal: options.signal })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new HttpError(response.status, url, body)
  }
  if (!response.body) {
    throw new Error(`Сервер не вернул файл: ${url}`)
  }

  const headerLength = Number(response.headers.get('content-length') ?? 0)
  const total = options.size && options.size > 0 ? options.size : Number.isFinite(headerLength) ? headerLength : 0
  const hash = createHash('sha1')

  let received = 0
  let lastReport = 0

  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      received += chunk.length

      const now = Date.now()
      if (now - lastReport >= 120 || (total > 0 && received >= total)) {
        lastReport = now
        options.onProgress?.(received, total)
      }

      callback(null, chunk)
    }
  })

  const body = response.body as NodeWebReadableStream<Uint8Array>
  await pipeline(Readable.fromWeb(body), progress, createWriteStream(partPath))

  if (total > 0) options.onProgress?.(received, total)

  if (options.sha1) {
    const actual = hash.digest('hex')
    if (actual !== options.sha1.toLowerCase()) {
      throw new Error(
        `Проверка SHA-1 не пройдена: ${url}. Ожидалось ${options.sha1}, получено ${actual}.`
      )
    }
  }
}
