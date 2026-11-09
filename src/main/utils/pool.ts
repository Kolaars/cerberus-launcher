import { createAbortError } from './text'

export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (items.length === 0) return

  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))

  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? createAbortError('Операция отменена')
      }

      const index = nextIndex++
      if (index >= items.length) return
      await worker(items[index], index)
    }
  })

  await Promise.all(runners)
}
