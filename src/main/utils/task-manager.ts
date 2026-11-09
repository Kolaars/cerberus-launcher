import { randomUUID } from 'node:crypto'
import { createAbortError } from './text'

export interface TaskHandle {
  id: string
  signal: AbortSignal
}

export class TaskManager {
  private readonly controllers = new Map<string, AbortController>()

  create(): TaskHandle {
    const id = randomUUID()
    const controller = new AbortController()
    this.controllers.set(id, controller)
    return { id, signal: controller.signal }
  }

  cancel(taskId: string): boolean {
    const controller = this.controllers.get(taskId)
    if (!controller) return false
    controller.abort(createAbortError('Операция отменена'))
    return true
  }

  finish(taskId: string): void {
    this.controllers.delete(taskId)
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort(createAbortError('Приложение закрывается'))
    }
    this.controllers.clear()
  }
}
