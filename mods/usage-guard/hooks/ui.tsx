import type { Elements, RenderChildren } from 'claude-code'

import type { UsageHold, UsageRate, UsageWindow } from '../types'

import { describe, label } from './estimate'

type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

const FILLED = '█'
const EMPTY = '░'

/** Green while comfortable, blue past 60%, amber past 85%, red near the end. */
export const toneFor = (pct: number): string => {
  if (pct >= 95) return 'error'
  if (pct >= 85) return 'warning'
  if (pct >= 60) return 'suggestion'
  return 'success'
}

/** A bar `width` cells wide, filled to `pct`; `extra` points more are drawn lighter, as a forecast. */
export const Bar = ({ Text }: Ui, pct: number, width: number, extra = 0) => {
  const cells = (p: number) => Math.max(0, Math.min(width, Math.round((p / 100) * width)))
  const filled = cells(pct)
  const forecast = Math.max(0, cells(pct + extra) - filled)

  return (
    <Text>
      <Text color={toneFor(pct)}>{FILLED.repeat(filled)}</Text>
      <Text color={toneFor(pct + extra)} dimColor>
        {FILLED.repeat(forecast)}
      </Text>
      <Text dimColor>{EMPTY.repeat(width - filled - forecast)}</Text>
    </Text>
  )
}

const pctText = (pct: number): string => `${Math.round(pct * 10) / 10}%`

/** One window: label and percentage, the bar, then its reset and pace lines. */
const WindowBlock = (ui: Ui, w: UsageWindow, rate: UsageRate | undefined, now: number, width: number) => {
  const { Box, Text } = ui
  const d = describe(w, rate, now)
  const extra = d.perPrompt ?? 0

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold>{label(w.kind)}</Text>
        <Text bold color={toneFor(w.percentUsed)}>
          {pctText(w.percentUsed)}
        </Text>
      </Box>
      {Bar(ui, w.percentUsed, width, extra)}
      <Text dimColor wrap="truncate-end">
        {[
          d.resetIn !== undefined ? `resets in ${d.resetIn}` : null,
          d.perPrompt !== undefined
            ? d.left === null
              ? '<0.1% per prompt'
              : `average prompt ~${d.perPrompt}% · ~${d.left} left`
            : null,
        ]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      {d.pace && <Text color={d.pace.isRisk ? 'warning' : 'success'}>{d.pace.text}</Text>}
    </Box>
  )
}

const barWidth = (columns: number): number => Math.max(12, Math.min(36, columns - 14))

/** The card the /usage-guard command draws in the transcript. */
export const UsageCard = (
  ui: Ui,
  list: readonly UsageWindow[],
  rates: Record<string, UsageRate>,
  now: number,
  columns: number,
) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1} marginY={1}>
      <Text bold color="claude">
        Claude usage
      </Text>
      {list.length === 0 && (
        <Text dimColor>No readings yet. They arrive with the first reply on a Claude subscription.</Text>
      )}
      {list.map(w => WindowBlock(ui, w, rates[w.kind], now, barWidth(columns)))}
    </Box>
  )
}

/** What is drawn above the prompt box while a large prompt waits for the person's decision. */
export const HeldPanel = (
  ui: Ui,
  held: UsageHold,
  list: readonly UsageWindow[],
  rates: Record<string, UsageRate>,
  now: number,
  columns: number,
  buttons: RenderChildren,
) => {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
      <Text bold color="warning">
        Large prompt — continue?
      </Text>
      <Text>This looks token-heavy: {held.reasons.join(', ')}.</Text>
      {list.length === 0 && <Text dimColor>No usage reading yet, so no estimate.</Text>}
      {list.map(w => WindowBlock(ui, w, rates[w.kind], now, barWidth(columns)))}
      <Box marginTop={1}>{buttons}</Box>
      <Text dimColor>Enter sends it as it is. The lighter part of each bar is what an average prompt adds; a large one costs more.</Text>
    </Box>
  )
}
