export function ProgressBar({
  percent,
  label
}: {
  percent: number
  label?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-label={label ?? 'Прогресс'}
    >
      <div className="progress__fill" style={{ width: `${value}%` }} />
    </div>
  )
}
