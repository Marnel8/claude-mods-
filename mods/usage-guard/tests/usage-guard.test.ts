import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { UsageWindow } from '../types'
import { estimate, formatDuration, roughTokens, weigh } from '../hooks/estimate'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-12T12:00:00Z')

/** The engine beneath the plugin: usage readings, the prompt box, the queue. */
const engine = (on: On, windows: UsageWindow[], filled: string[]) => {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: windows } }))
  on('prompt.fill', (_$, e) => (filled.push(e.text), { isFilled: true }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
}

const typed = (text: string, attachments?: { type: 'image' }[]) => ({
  text,
  attachments,
  wait: false,
  origin: { kind: 'composer' as const },
})

const fiveHour = (percentUsed: number): UsageWindow => ({
  kind: 'five_hour',
  percentUsed,
  resetsAt: new Date(NOW + 2 * HOUR).toISOString(),
})

const LONG = 'please review this function and explain it. '.repeat(200)

describe('prompt.submit', () => {
  test('an ordinary prompt is never held, whatever the usage', async ($, on) => {
    engine(on, [fiveHour(97)], [])
    expect((await $.prompt.submit(typed('fix the typo in README'))).drop).toBeUndefined()
  })

  test('a long prompt is held with usage figures, then sent on the second Enter', async ($, on) => {
    const filled: string[] = []
    engine(on, [fiveHour(48)], filled)

    const first = await $.prompt.submit(typed(LONG))
    expect(first.drop).toContain('long prompt')
    expect(first.drop).toContain('5-hour 48%')
    expect(filled).toEqual([LONG])

    expect((await $.prompt.submit(typed(LONG))).drop).toBeUndefined()
  })

  test('a different prompt after a hold is judged afresh', async ($, on) => {
    engine(on, [fiveHour(48)], [])
    await $.prompt.submit(typed(LONG))
    expect((await $.prompt.submit(typed('short one'))).drop).toBeUndefined()
    expect((await $.prompt.submit(typed(LONG))).drop).toContain('long prompt')
  })

  test('attachments and whole-codebase wording hold a short prompt', async ($, on) => {
    engine(on, [], [])
    expect((await $.prompt.submit(typed('what is this?', [{ type: 'image' }]))).drop).toContain('1 attachment')
    expect((await $.prompt.submit(typed('rename it across the entire codebase'))).drop).toContain('whole codebase')
  })

  test('never holds a prompt that did not come from the person', async ($, on) => {
    engine(on, [fiveHour(99)], [])
    const r = await $.prompt.submit({ text: LONG, wait: false, origin: { kind: 'task-notification' } })
    expect(r.drop).toBeUndefined()
  })

  test('the size limit and the wording check are options', { options: { minTokens: 100000, broadScope: false } }, async ($, on) => {
    engine(on, [], [])
    expect((await $.prompt.submit(typed(LONG))).drop).toBeUndefined()
    expect((await $.prompt.submit(typed('rename it across the entire codebase'))).drop).toBeUndefined()
  })
})

describe('weigh', () => {
  test('counts about four characters to a token', () => {
    expect(roughTokens('a'.repeat(400))).toBe(100)
  })

  test('says nothing about an ordinary prompt', () => {
    expect(weigh('add a loading spinner to the profile screen', 0, 1500, true)).toBeUndefined()
    expect(weigh('update all the docs for this change', 0, 1500, true)).toBeUndefined()
  })

  test('lists every reason', () => {
    const w = weigh(LONG + ' every file', 2, 1500, true)
    expect(w?.reasons).toHaveLength(3)
  })
})

describe('estimates', () => {
  test('formats durations', () => {
    expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m')
    expect(formatDuration(3 * 24 * HOUR + 4 * HOUR)).toBe('3d 4h')
    expect(formatDuration(5 * 60 * 1000)).toBe('5m')
  })

  test('per-prompt cost, prompts left and pace', () => {
    // 3h into a 5h window at 66%: 22%/h, so the other 34% goes in ~1h 33m, before the reset.
    const w = { kind: 'five_hour', percentUsed: 66, resetsAt: new Date(NOW + 2 * HOUR).toISOString() }
    const parts = estimate(w, { perPrompt: 2, samples: 3 }, NOW)
    expect(parts).toEqual(['resets in 2h 00m', '~2%/prompt (~17 left)', 'at this pace, limit in ~1h 33m'])
  })

  test('weekly window on a slow pace projects below the limit', () => {
    const w = { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 5 * 24 * HOUR).toISOString() }
    expect(estimate(w, undefined, NOW)).toEqual(['resets in 5d 0h', 'on pace for ~70%'])
  })
})
