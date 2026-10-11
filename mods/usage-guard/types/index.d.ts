/** One rate-limit window as last reported: `five_hour`, `seven_day`, ... */
export type UsageWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** A large prompt held for the person's decision, with why and when. */
export type UsageHold = { text: string; tokens: number; reasons: string[]; at: number }

/** Rolling estimate of how many points one prompt costs, per window. */
export type UsageRate = { perPrompt: number; samples: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-guard': {
      windows: UsageWindow[]
      hold: UsageHold | null
      rates: Record<string, UsageRate>
    }
  }
}
