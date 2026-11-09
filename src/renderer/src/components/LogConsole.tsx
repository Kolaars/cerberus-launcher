import { useEffect, useRef } from 'react'
import type { LaunchLog, LaunchStatus } from '@shared/types'
import { ChevronDownIcon, TerminalIcon } from './Icons'

export function LogConsole({
  logs,
  open,
  onToggle,
  onClear,
  status
}: {
  logs: LaunchLog[]
  open: boolean
  onToggle: () => void
  onClear: () => void
  status: LaunchStatus
}) {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const body = bodyRef.current
    if (!body) return
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120
    if (nearBottom) body.scrollTop = body.scrollHeight
  }, [logs.length, open])

  return (
    <section className={`console${open ? ' console--open' : ''}`}>
      <div className="console__header">
        <button type="button" className="console__toggle" onClick={onToggle} aria-expanded={open}>
          <TerminalIcon size={18} />
          <span>Консоль</span>
          <span className="console__count">{logs.length}</span>
          <span className={`console__dot console__dot--${status}`} aria-hidden="true" />
          <ChevronDownIcon size={16} className="console__chevron" />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={onClear}
          disabled={logs.length === 0}
        >
          Очистить
        </button>
      </div>

      {open ? (
        <div className="console__body" ref={bodyRef} role="log" aria-live="off">
          {logs.length === 0 ? (
            <p className="console__empty">
              Логи появятся здесь после запуска игры. Установка показывает прогресс отдельно.
            </p>
          ) : (
            logs.map((line, index) => (
              <div key={`${line.timestamp}-${index}`} className="console__line">
                <span className="console__time">{formatTime(line.timestamp)}</span>
                <span className={`console__text console__text--${line.stream}`}>{line.line}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  )
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('ru-RU', { hour12: false })
}
