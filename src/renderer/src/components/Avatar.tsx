import type { Account } from '@shared/types'
import { UserIcon } from './Icons'

export function AccountAvatar({
  account,
  size = 40
}: {
  account: Account | null
  size?: number
}) {
  if (!account) {
    return (
      <span
        className="avatar avatar--empty"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <UserIcon size={Math.round(size * 0.45)} />
      </span>
    )
  }

  if (account.skinUrl) {
    return (
      <span
        className="avatar avatar--skin"
        role="img"
        aria-label={`Скин ${account.username}`}
        style={{
          width: size,
          height: size,
          backgroundImage: `url("${account.skinUrl}")`,
          backgroundSize: `${size * 8}px ${size * 8}px`,
          backgroundPosition: `-${size}px -${size}px`
        }}
      />
    )
  }

  const hue = hueFromString(account.username)
  const initials = account.username.slice(0, 2).toUpperCase()

  return (
    <span
      className="avatar avatar--initials"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.36),
        background: `linear-gradient(135deg, hsl(${hue} 52% 32%), hsl(${(hue + 42) % 360} 48% 18%))`
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}

function hueFromString(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360
  }
  return hash
}
