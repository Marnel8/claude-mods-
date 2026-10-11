import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const current = atom({ plugin: 'model-badge', key: 'model' } as const, null)
const frame = atom({ plugin: 'model-badge', key: 'frame' } as const, 0) // the beat count; its pace follows the effort
const startedAt = atom({ plugin: 'model-badge', key: 'startedAt' } as const, 0)
const effort = atom({ plugin: 'model-badge', key: 'effort' } as const, null)
const notice = atom({ plugin: 'model-badge', key: 'notice' } as const, null)

// ── Customize the icon here ────────────────────────────────────────────────
// SPINNER_FRAMES: cycled while a turn runs (one entry = a static icon).
// DONE_ICON: shown on the finished-turn line ("Baked for 3s").
// Presets to copy in:
//   classic:   ['·', '✢', '✳', '∗', '✻', '✽', '✻', '∗', '✳', '✢']  (current; done icon ✻)
//   blades:    ['◢', '◣', '◤', '◥']  (done icon ◈)
//   flowers:   ['·', '⚬', '✿', '❀', '❁', '❀', '✿', '⚬']
//   orbit:     ['◜', '◠', '◝', '◞', '◡', '◟']
//   scanner:   ['▰▱▱▱', '▱▰▱▱', '▱▱▰▱', '▱▱▱▰', '▱▱▰▱', '▱▰▱▱']
//   braille:   ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
//   moon:      ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
//   owl:       ['🦉']
//   pulse:     ['●', '◉', '○', '◉']
const SPINNER_FRAMES = ['·', '✢', '✳', '∗', '✻', '✽', '✻', '∗', '✳', '✢']
const DONE_ICON = '✻'
// ───────────────────────────────────────────────────────────────────────────

type Badge = { label: string; color: string }

// Violet = Opus; blue = Sonnet; teal = Haiku; orange = Fable (the newest top tier). Shades fade with age.
const ORANGE = '#D97757' // Claude's own clay orange
const VIOLET = { latest: '#8B5CF6', mid: '#A78BFA', old: '#C4B5FD' }
const TEAL = { latest: '#14B8A6', mid: '#2DD4BF', old: '#5EEAD4' }
const BLUE = { latest: '#3B82F6', mid: '#60A5FA', old: '#93C5FD' }

// ── The mascot ─────────────────────────────────────────────────────────────
// The Claude Code icon, traced pixel for pixel: an 18x5 grid (14-wide body, 2-pixel arms on the
// middle row, two eye holes, four 1-pixel legs). Drawn with quadrant blocks, 2x2 pixels per
// character, so it is 9 columns by 3 rows. Only the legs move: A (the icon as is), B (feet in),
// A, C (feet out). It scuttles back and forth along the band; the body, arms and eyes never change.
const SPRITE_COLS = 18
const SPRITE_ROWS = 6 // 5 pixel rows, padded to an even count for the 2x2 blocks
const CRAB_W = SPRITE_COLS / 2 // columns of text
const STRIDE = 2 // columns it covers per beat
export const LEGS = [[2, 4, 13, 15], [3, 5, 12, 14], [2, 4, 13, 15], [1, 3, 14, 16]] as const
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█' // index = upper-left | upper-right<<1 | lower-left<<2 | lower-right<<3

export function drawSprite(width: number, x: number, legs: readonly number[]): string[] {
  const grid: boolean[][] = Array.from({ length: SPRITE_ROWS }, () => Array<boolean>(width * 2).fill(false))
  const set = (row: number, col: number) => {
    grid[row]![x * 2 + col] = true
  }
  for (let row = 0; row <= 3; row++) for (let col = 2; col <= 15; col++) set(row, col)
  grid[1]![x * 2 + 4] = false // eye holes
  grid[1]![x * 2 + 13] = false
  for (const col of [0, 1, 16, 17]) set(2, col) // arms
  for (const col of legs) set(4, col)
  const rows: string[] = []
  for (let y = 0; y < SPRITE_ROWS; y += 2) {
    let line = ''
    for (let col = 0; col < width; col++) {
      const i =
        (grid[y]![col * 2] ? 1 : 0) |
        (grid[y]![col * 2 + 1] ? 2 : 0) |
        (grid[y + 1]![col * 2] ? 4 : 0) |
        (grid[y + 1]![col * 2 + 1] ? 8 : 0)
      line += QUADRANTS[i]
    }
    rows.push(line)
  }
  return rows
}

// Where the icon is and which leg pose it is in on a given beat of the steady timer.
export function crabAt(beat: number, width: number): string[] {
  const track = Math.max(1, width - CRAB_W)
  const cycle = Math.ceil(track / STRIDE) * 2
  const step = beat % cycle
  const half = cycle / 2
  const x = Math.min(track, (step <= half ? step : cycle - step) * STRIDE)
  return drawSprite(width, x, LEGS[beat % LEGS.length]!)
}
// ───────────────────────────────────────────────────────────────────────────

// Lower effort lightens the model's color toward white; max effort is the full color.
const LIGHTEN: Record<string, number> = { low: 0.6, medium: 0.45, high: 0.3, xhigh: 0.15, max: 0 }

// Ticks of 60ms per beat: the lower the effort, the slower the icon moves.
const TEMPO: Record<string, number> = { low: 8, medium: 6, high: 4, xhigh: 3, max: 2 }

export function tint(hex: string, level: string | null): string {
  const amount = level === null ? 0 : (LIGHTEN[level] ?? 0.15)
  const channel = (i: number) => {
    const v = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

export function badge(id: string): Badge {
  const lower = id.toLowerCase()
  const family = /(opus|sonnet|haiku|fable)/.exec(lower)?.[1]
  if (family === undefined) return { label: id, color: '#9CA3AF' }

  // Version digits: short numbers only, so a date stamp (20250514) is ignored.
  const nums = (lower.match(/\d+/g) ?? []).filter(n => n.length <= 2).map(Number)
  const major = nums[0] ?? 0
  const version = nums.length > 1 ? `${nums[0]}.${nums[1]}` : nums.length === 1 ? `${nums[0]}` : ''
  const label = `${family[0]!.toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`

  const tier = major >= 5 ? 'latest' : major === 4 ? 'mid' : 'old'
  if (family === 'sonnet') return { label, color: BLUE[tier] }
  if (family === 'haiku') return { label, color: TEAL[tier] }
  if (family === 'opus') return { label, color: VIOLET[tier] }
  // fable (the newest top tier) wears Claude's orange
  return { label, color: ORANGE }
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined
  const stop = () => {
    timer?.cancel()
    timer = undefined
  }

  on('turn.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, startedAt, () => now)
    return next(e)
  })

  const remember = (model: string) => (_: string | null) => model

  on('session.start', async ($, e, next) => {
    // One steady beat for the whole session: drives the spinner glyph and the walking crab.
    stop()
    let ticks = 0
    timer = $.clock.every(60, () => {
      ticks += 1
      // The beat's pace follows the effort: low effort ambles, max effort scuttles.
      void read($, effort).then(async level => {
        const every = TEMPO[level ?? 'high'] ?? 4
        if (ticks % every === 0) await update($, frame, n => n + 1)
      })
      // Every couple of seconds, catch an effort change made from any menu or command.
      if (ticks % 32 === 0) {
        void $.config
          .list()
          .then(async rows => {
            const row = rows.find(r => /effort/i.test(r.key))
            const level = row && typeof row.value === 'string' ? row.value.toLowerCase() : null
            if (level && (await read($, effort)) !== level) await update($, effort, () => level)
          })
          .catch(() => undefined)
      }
    })
    await update($, current, remember(await $.session.model()))
    return next(e)
  })

  // Loud toast whenever the model changes (/model, resume, or an automatic fallback).
  let noticeTimer: { cancel: () => void } | undefined
  const changed = (from: string | null, to: string) =>
    from === null || from === to
      ? undefined
      : { text: `MODEL CHANGED  ${badge(from).label} → ${badge(to).label}`, color: badge(to).color }

  // Right after /model or /effort, pick up the new level without waiting for the next request.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    if (e.command === 'model' || e.command === 'effort') {
      const arg = e.args.trim().toLowerCase()
      if (e.command === 'effort' && arg in LIGHTEN) {
        await update($, effort, () => arg)
      } else {
        const rows = await $.config.list()
        const row = rows.find(r => /effort/i.test(r.key))
        if (row && typeof row.value === 'string') await update($, effort, () => String(row.value).toLowerCase())
      }
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.PostModelSwitch', async ($, e, next) => {
    const note = changed(await read($, current), e.to_model)
    if (note) {
      await update($, notice, () => note)
      noticeTimer?.cancel()
      noticeTimer = $.clock.after(6000, () => {
        void update($, notice, () => null)
      })
    }
    await update($, current, remember(e.to_model))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const level = typeof e.effort === 'string' ? e.effort : e.effort === undefined ? null : 'medium'
      if ((await read($, effort)) !== level) await update($, effort, () => level)
      const known = await read($, current)
      if (known !== e.model) {
        const note = changed(known, e.model)
        if (note) {
      await update($, notice, () => note)
      noticeTimer?.cancel()
      noticeTimer = $.clock.after(6000, () => {
        void update($, notice, () => null)
      })
    }
        await update($, current, remember(e.model))
      }
    }
    return yield* next(e)
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const model = (await read($, current)) ?? (await $.session.model())
    const color = tint(badge(model).color, await read($, effort))
    const { Text } = $.ui.resolve(e)
    const text = e.props.message ?? e.props.word
    const glyph = SPINNER_FRAMES[(await read($, frame)) % SPINNER_FRAMES.length]
    const seconds = Math.max(0, Math.round(((await $.clock.now()) - (await read($, startedAt))) / 1000))

    return (
      <Text color={color} bold>
        {glyph} {text}
        {text.endsWith('…') ? '' : e.props.suffix} <Text dimColor>({seconds}s)</Text>
      </Text>
    )
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const model = (await read($, current)) ?? (await $.session.model())
    const color = tint(badge(model).color, await read($, effort))
    const { Text } = $.ui.resolve(e)
    const total = Math.round(e.props.durationMs / 1000)
    const time = total >= 60 ? `${Math.floor(total / 60)}m ${total % 60}s` : `${total}s`

    return (
      <Text color={color}>
        {DONE_ICON} {e.props.word} for {time}
      </Text>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const model = (await read($, current)) ?? (await $.session.model())
    const level = await read($, effort)
    const color = tint(badge(model).color, level)
    const { label } = badge(model)
    const { Box, Text } = $.ui.resolve(e)
    const flash = await read($, notice)

    // A model change takes over the band for a few seconds: a centered, full-color banner.
    if (flash) {
      return (
        <Box justifyContent="center" width="100%">
          <Text backgroundColor={flash.color} color="#0B0B0F" bold>
            {'   '}
            {flash.text}
            {'   '}
          </Text>
        </Box>
      )
    }

    const width = Math.max(CRAB_W + 4, Math.min(e.props.bodyColumns || 80, 200))
    const art = crabAt(await read($, frame), width)

    return (
      <Box flexDirection="column" width="100%">
        <Box>
          <Text backgroundColor={color} color="#0B0B0F" bold>
            {' '}
            {label.toUpperCase()}{' '}
          </Text>
          <Text color={color} dimColor>
            {'  '}
            {model}
            {level ? ` · ${level}` : ''}
          </Text>
        </Box>
        <Box flexDirection="column" width={width}>
          {art.map((line, i) => (
            <Text key={i} color={color}>
              {line}
            </Text>
          ))}
        </Box>
      </Box>
    )
  })
}
