import { expect, mock, test } from 'claude-code/testing'

import { drawSprite, LEGS } from './register'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80 },
} as const

const COLORS: Record<string, string> = {
  'claude-sonnet-5-5': '#3B82F6',
  'claude-opus-5-5': '#8B5CF6',
  'claude-fable-5-1': '#D97757',
  'claude-haiku-5-5': '#14B8A6',
  'claude-haiku-4-5-20251001': '#2DD4BF',
  'claude-sonnet-4-5-20250929': '#60A5FA',
  'claude-opus-4-1-20250805': '#A78BFA',
}

for (const [model, color] of Object.entries(COLORS)) {
  test(`${model} is drawn ${color}`, async ($, on) => {
    on('session.model', () => ({ value: model }))
    const ui = await $.ui.mount({ plugin: 'model-badge', surface: 'terminal', ...BAND } as never)
    const found = await ui.find({ type: 'Text', text: /\b(SONNET|OPUS|FABLE|HAIKU)\b/ })
    expect(found).toBeDefined()
    expect(JSON.stringify(found).toUpperCase()).toContain(color.toUpperCase())
    await ui.unmount()
  })
}

test('spinner takes the model color and keeps a timer', async ($, on) => {
  mock.clock(on)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  const ui = await $.ui.mount({
    plugin: 'model-badge',
    surface: 'terminal',
    component: 'Spinner',
    props: { word: 'Dilly-dallying', message: null, suffix: '…', mode: 'thinking' },
  } as never)
  const found = await ui.find({ type: 'Text', text: /Dilly-dallying/ })
  expect(found).toBeDefined()
  expect(JSON.stringify(found).toUpperCase()).toContain('#8B5CF6')
  expect(JSON.stringify(found)).toContain('0s')
  await ui.unmount()
})

test('turn duration line takes the model color', async ($, on) => {
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  const ui = await $.ui.mount({
    plugin: 'model-badge',
    surface: 'terminal',
    component: 'TurnDuration',
    props: { word: 'Baked', durationMs: 64000 },
  } as never)
  const found = await ui.find({ type: 'Text', text: /Baked for 1m 4s/ })
  expect(found).toBeDefined()
  expect(JSON.stringify(found).toUpperCase()).toContain('#3B82F6')
  await ui.unmount()
})

test('mascot: only the leg row changes between poses', () => {
  const [a, b, a2, c] = LEGS.map(legs => drawSprite(9, 0, legs))
  for (const pose of [b!, c!]) {
    expect(pose[0]).toBe(a![0]) // body, eyes
    expect(pose[1]).toBe(a![1]) // arms
    expect(pose[2]).not.toBe(a![2]) // legs
  }
  expect(a2).toEqual(a)
  expect(a).toEqual([' █▜███▛█ ', '▀███████▀', ' ▘▘   ▝▝ '])
})
