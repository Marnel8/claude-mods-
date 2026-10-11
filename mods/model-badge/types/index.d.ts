declare module 'claude-code' {
  interface PluginState {
    'model-badge': {
      model: string | null
      frame: number
      startedAt: number
      effort: string | null
      notice: { text: string; color: string } | null
    }
  }
}
