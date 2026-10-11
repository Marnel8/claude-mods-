import { describe, expect, mock, test } from 'claude-code/testing'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-12T12:00:00Z')
const LONG = 'review this function and explain it. '.repeat(200)
const ABOVE = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const resets = (ms: number) => new Date(NOW + ms).toISOString()

describe('drawing', () => {
  test('the usage card and the band draw on every surface', async ($, on) => {
    const windows = [
      { kind: 'five_hour', percentUsed: 48, resetsAt: resets(2 * HOUR) },
      { kind: 'seven_day', percentUsed: 38, resetsAt: resets(4 * 24 * HOUR) },
    ]
    mock.clock(on, { now: NOW })
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: windows } }))
    on('prompt.submit', (_$, e) => ({ text: e.text }))
    // Another plugin's mascot already draws in the band: ours must sit beside it, not replace it.
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>crab</Text>
    })
    on('prompt.fill', () => ({ isFilled: true }))

    for (const surface of ['terminal', 'desktop'] as const) {
      // No hold, no band: only the other plugin's mascot is there.
      const quiet = await $.ui.mount({ plugin: 'usage-guard', surface, component: 'AbovePrompt', props: ABOVE })
      expect(await quiet.find({ type: 'Text', text: /crab/ })).toBeDefined()
      expect(await quiet.find({ type: 'Text', text: /Large prompt/ })).toBeUndefined()
      await quiet.unmount()

      await $.prompt.submit({ text: LONG, wait: false, origin: { kind: 'composer' } })
      const card = await $.ui.mount({
        plugin: 'usage-guard',
        surface,
        component: 'CommandOutput',
        props: { command: 'usage-guard', args: '', text: '', isErrored: false },
      })
      expect(await card.find({ type: 'Text', text: /Claude usage/ })).toBeDefined()
      expect(await card.find({ type: 'Text', text: /48%/ })).toBeDefined()
      expect(await card.find({ type: 'Text', text: /Weekly/ })).toBeDefined()
      await card.unmount()

      // The large prompt is held: the panel appears beside the mascot, with both buttons.
      const band = await $.ui.mount({ plugin: 'usage-guard', surface, component: 'AbovePrompt', props: ABOVE })
      expect(await band.find({ type: 'Text', text: /crab/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /Large prompt/ })).toBeDefined()
      expect(await band.find({ type: 'Text', text: /5-hour/ })).toBeDefined()
      expect(await band.find({ key: 'send' })).toBeDefined()
      await band.press({ key: 'cancel' })
      await band.unmount()
    }
  })
})
