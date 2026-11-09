import { splitArgs } from '../../utils/text'
import type { RuleContext } from './rules'
import { rulesAllow } from './rules'
import type { VersionArgument } from './types'

export function evaluateArguments(
  entries: VersionArgument[] | undefined,
  context: RuleContext,
  replacements: Record<string, string>
): string[] {
  const result: string[] = []

  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      result.push(replace(entry, replacements))
      continue
    }

    if (!rulesAllow(entry.rules, context)) continue

    if (Array.isArray(entry.value)) {
      for (const value of entry.value) result.push(replace(value, replacements))
    } else {
      result.push(replace(entry.value, replacements))
    }
  }

  return result
}

export function evaluateLegacyArguments(
  value: string | undefined,
  replacements: Record<string, string>
): string[] {
  if (!value) return []
  return splitArgs(value).map((part) => replace(part, replacements))
}

function replace(value: string, replacements: Record<string, string>): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => replacements[key] ?? match)
}
