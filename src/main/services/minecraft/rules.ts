import { currentArch, currentOsName, currentOsVersion, type RuleOsName } from '../../utils/platform'
import type { Rule } from './types'

export interface RuleContext {
  osName: RuleOsName
  arch: string
  osVersion: string
  features: Record<string, boolean>
}

export function createRuleContext(): RuleContext {
  return {
    osName: currentOsName(),
    arch: currentArch(),
    osVersion: currentOsVersion(),
    features: {
      is_demo_user: false,
      has_custom_resolution: false,
      has_quick_plays_support: false,
      is_quick_play_singleplayer: false,
      is_quick_play_multiplayer: false,
      is_quick_play_realms: false
    }
  }
}

export function rulesAllow(rules: Rule[] | undefined, context: RuleContext): boolean {
  if (!rules || rules.length === 0) return true

  let allowed = false
  for (const rule of rules) {
    if (!ruleMatches(rule, context)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

function ruleMatches(rule: Rule, context: RuleContext): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== context.osName) return false
    if (rule.os.arch && rule.os.arch !== context.arch) return false

    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(context.osVersion)) return false
      } catch {
        return false
      }
    }
  }

  if (rule.features) {
    for (const [feature, expected] of Object.entries(rule.features)) {
      if ((context.features[feature] ?? false) !== expected) return false
    }
  }

  return true
}
