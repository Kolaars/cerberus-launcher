import type { IpcResult } from '@shared/result'

export async function unwrap<T>(resultPromise: Promise<IpcResult<T>>): Promise<T> {
  const result = await resultPromise
  if (!result.ok) throw new Error(result.error)
  return result.value
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  }
  return String(error)
}
