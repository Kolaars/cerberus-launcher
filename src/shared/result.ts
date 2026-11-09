export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string }

export function ipcOk<T>(value: T): IpcResult<T> {
  return { ok: true, value }
}

export function ipcFail(error: unknown): IpcResult<never> {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message }
}
