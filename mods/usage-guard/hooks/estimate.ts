import type { UsageRate, UsageWindow } from '../types'

const HOUR_MS = 60 * 60 * 1000
const WINDOW_MS: Record<string, number> = {
  five_hour: 5 * HOUR_MS,
  seven_day: 7 * 24 * HOUR_MS,
}
const LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  spend_limit: 'Spend',
}

export const label = (kind: string): string => LABELS[kind] ?? kind

export const formatDuration = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`
  return `${mins}m`
}

export type Pace = { kind: 'reached' | 'limit' | 'projection'; text: string; isRisk: boolean }

export type Detail = {
  resetIn?: string
  perPrompt?: number
  left?: number | null
  pace?: Pace
}

/** The estimates for one window as data: reset, cost per prompt, pace. */
export const describe = (w: UsageWindow, rate: UsageRate | undefined, now: number): Detail => {
  const detail: Detail = {}
  const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
  const untilReset = Number.isNaN(resetsAt) ? null : resetsAt - now

  if (untilReset !== null) detail.resetIn = formatDuration(untilReset)

  if (rate && rate.samples > 0) {
    detail.perPrompt = Math.round(rate.perPrompt * 10) / 10
    detail.left = rate.perPrompt >= 0.05 ? Math.floor(Math.max(0, 100 - w.percentUsed) / rate.perPrompt) : null
  }

  const span = WINDOW_MS[w.kind]
  if (span && untilReset !== null) {
    const elapsed = span - untilReset
    if (w.percentUsed >= 100) {
      detail.pace = { kind: 'reached', text: 'limit reached', isRisk: true }
    } else if (elapsed > span * 0.05 && w.percentUsed > 0) {
      const perMs = w.percentUsed / elapsed
      const toLimit = (100 - w.percentUsed) / perMs
      detail.pace = toLimit < untilReset
        ? { kind: 'limit', text: `at this pace, limit in ~${formatDuration(toLimit)}`, isRisk: true }
        : { kind: 'projection', text: `on pace for ~${Math.round(w.percentUsed + perMs * untilReset)}%`, isRisk: false }
    }
  }

  return detail
}

/** Plain-language estimates for one window, as lines of text. */
export const estimate = (w: UsageWindow, rate: UsageRate | undefined, now: number): string[] => {
  const d = describe(w, rate, now)
  const parts: string[] = []
  if (d.resetIn !== undefined) parts.push(`resets in ${d.resetIn}`)
  if (d.perPrompt !== undefined) {
    parts.push(d.left === null ? '<0.1%/prompt' : `~${d.perPrompt}%/prompt (~${d.left} left)`)
  }
  if (d.pace) parts.push(d.pace.text)
  return parts
}

export type Weight = { tokens: number; reasons: string[] }

const BROAD_SCOPE =
  /\b(?:entire|whole)\s+(?:code\s?base|repo(?:sitory)?|project|app|monorepo)\b|\bevery\s+(?:file|component|screen|test)\b|\ball\s+(?:the\s+|of\s+the\s+)?(?:files|components|screens|tests)\b|\bacross\s+(?:the\s+|all\s+)?(?:code\s?base|repo(?:sitory)?|project)\b/i

/** Rough size of a prompt in tokens: about four characters each. */
export const roughTokens = (text: string): number => Math.ceil(text.length / 4)

/**
 * Whether a prompt looks large or token-hungry, and why: its own size,
 * attached images or documents, or wording that sweeps a whole codebase.
 * Undefined for an ordinary prompt.
 */
export const weigh = (
  text: string,
  attachments: number,
  minTokens: number,
  isBroadScopeChecked: boolean,
): Weight | undefined => {
  const tokens = roughTokens(text)
  const reasons: string[] = []

  if (tokens >= minTokens) reasons.push(`a long prompt (~${tokens.toLocaleString('en-US')} tokens)`)
  if (attachments > 0) reasons.push(`${attachments} attachment${attachments === 1 ? '' : 's'}`)
  if (isBroadScopeChecked && BROAD_SCOPE.test(text)) reasons.push('wording that covers the whole codebase')

  return reasons.length > 0 ? { tokens, reasons } : undefined
}
