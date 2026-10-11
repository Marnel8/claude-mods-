import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { UsageHold, UsageRate, UsageWindow } from '../types'

import { estimate, label, weigh } from './estimate'
import { HeldPanel, UsageCard } from './ui'

const windows = atom({ plugin: 'usage-guard', key: 'windows' } as const, [])
const hold = atom({ plugin: 'usage-guard', key: 'hold' } as const, null)
const rates = atom({ plugin: 'usage-guard', key: 'rates' } as const, {})

const RATES_KEY = 'rates'
const HOLD_EXPIRES_MS = 10 * 60 * 1000

const snapshot = async ($: EngineInterface): Promise<UsageWindow[]> => {
  const { rateLimits } = await $.session.usage()
  return rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt }))
}

export const register: Register = (on, options) => {
  const minTokens = Math.max(1, Number(options.minTokens ?? 1500))
  const isBroadScopeChecked = options.broadScope !== false

  // Usage at the start of the running main-loop turn, to measure what it cost.
  let before: UsageWindow[] | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-guard',
      description: 'Show 5-hour and weekly usage with per-prompt estimates',
    })
    const saved = (await $.store.get(RATES_KEY)) as Record<string, UsageRate> | undefined
    if (saved) await update($, rates, current => ({ ...saved, ...current }))
    const now = await snapshot($)
    if (now.length > 0) await update($, windows, () => now)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => e.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })))
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // Only the person's own prompts; notifications, peers and plugins pass.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)

    const held = await read($, hold)
    const now = await $.clock.now()

    // The same prompt sent again after a hold is the person's decision to continue.
    if (held && held.text === e.text && now - held.at < HOLD_EXPIRES_MS) {
      await update($, hold, () => null)
      return next(e)
    }

    const weight = weigh(e.text, e.attachments?.length ?? 0, minTokens, isBroadScopeChecked)
    if (!weight) {
      if (held) await update($, hold, () => null)
      return next(e)
    }

    const current = await snapshot($)
    if (current.length > 0) await update($, windows, () => current)
    const pending: UsageHold = { text: e.text, tokens: weight.tokens, reasons: weight.reasons, at: now }
    await update($, hold, () => pending)
    await $.prompt.fill({ text: e.text })

    const known = await read($, rates)
    const lines = current.map(w => `${label(w.kind)} ${w.percentUsed}%` + (known[w.kind] ? ` (average prompt ~${Math.round(known[w.kind]!.perPrompt * 10) / 10}%)` : ''))
    return {
      drop:
        `Large prompt: ${weight.reasons.join(', ')}.` +
        (lines.length ? ` Usage now: ${lines.join(', ')}.` : '') +
        ' Your prompt is back in the box — press Enter to send it anyway, or clear it to cancel.',
    }
  })

  on('turn.start', async ($, e, next) => {
    before = await snapshot($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || before === null) return result

    const start = before
    before = null
    const after = await snapshot($)
    if (after.length > 0) await update($, windows, () => after)

    const learned = await update($, rates, known => {
      const merged: Record<string, UsageRate> = { ...known }
      for (const w of after) {
        const was = start.find(s => s.kind === w.kind)
        // A reset in between makes the difference meaningless.
        if (!was || was.resetsAt !== w.resetsAt) continue
        const delta = Math.max(0, w.percentUsed - was.percentUsed)
        const prev = merged[w.kind]
        merged[w.kind] = prev && prev.samples > 0
          ? { perPrompt: prev.perPrompt * 0.7 + delta * 0.3, samples: prev.samples + 1 }
          : { perPrompt: delta, samples: 1 }
      }
      return merged
    })
    await $.store.set(RATES_KEY, learned)

    return result
  })

  on('command.run', { command: 'usage-guard' }, async $ => {
    const list = await snapshot($)
    if (list.length > 0) await update($, windows, () => list)
    if (list.length === 0) {
      return { text: 'No usage readings yet. They arrive with the first reply on a Claude subscription.' }
    }
    const known = await read($, rates)
    const now = await $.clock.now()
    const lines = list.map(w => {
      const details = estimate(w, known[w.kind], now)
      return `${label(w.kind)}: ${w.percentUsed}% used` + (details.length ? ` — ${details.join(', ')}` : '')
    })
    lines.push(`Large prompts (about ${minTokens.toLocaleString('en-US')} tokens or more) are held for your decision.`)

    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: 'usage-guard' } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)

    const ui = $.ui.resolve(e)
    const list = await read($, windows)
    const known = await read($, rates)
    const now = await $.clock.now()

    return UsageCard(ui, list, known, now, e.viewport?.columns ?? 80)
  })

  // Nothing is drawn above the prompt except while a large prompt waits for a decision.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const held = await read($, hold)
    if (e.props.hasSurvey || !held) return next(e)

    const ui = $.ui.resolve(e)
    const { Button, Box } = ui
    const list = await read($, windows)
    const known = await read($, rates)
    const now = await $.clock.now()
    // Other plugins draw in this band too (a mascot, a model badge): keep what is beneath and add ours.
    const beneath = await next(e)

    const buttons = (
      <Box gap={2}>
        <Button
          key="send"
          label="Send anyway"
          variant="primary"
          onPress={async () => {
            await update($, hold, () => null)
            await $.prompt.fill({ text: '' })
            await $.prompt.submit({ text: held.text, asUser: true })
          }}
        />
        <Button
          key="cancel"
          label="Cancel"
          onPress={async () => {
            await update($, hold, () => null)
            await $.prompt.fill({ text: '' })
          }}
        />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {beneath}
        {HeldPanel(ui, held, list, known, now, e.props.bodyColumns, buttons)}
      </Box>
    )
  })
}
