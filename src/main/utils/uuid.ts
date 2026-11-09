import { createHash } from 'node:crypto'

/**
 * UUID офлайн-игрока. Совпадает с UUID, который генерирует Java:
 * UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8)).
 */
export function offlineUuid(username: string): string {
  const bytes = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function stripUuidDashes(uuid: string): string {
  return uuid.replace(/-/g, '')
}

export function normalizeUuid(uuid: string): string {
  return stripUuidDashes(uuid).toLowerCase()
}
