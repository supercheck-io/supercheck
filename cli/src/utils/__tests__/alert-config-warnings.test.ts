import { describe, expect, it } from '@jest/globals'
import { normalizeAlertConfig, warningDefault } from '../alert-config.js'

describe('warning toggles round-trip relative to each kind default', () => {
  it('knows which kinds are on when unset', () => {
    expect(warningDefault('heartbeat_late')).toBe(false)
    for (const kind of ['mcp_tools_changed', 'mcp_slow', 'ai_slow_first_token', 'ai_model_changed', 'ai_tokens_high', 'agent_run_failed']) {
      expect(warningDefault(kind)).toBe(true)
    }
  })

  it('keeps only toggles that differ from the default', () => {
    expect(normalizeAlertConfig({ enabled: true, warnings: { mcp_tools_changed: false, mcp_slow: true, heartbeat_late: true } }))
      .toEqual({ enabled: true, warnings: { mcp_tools_changed: false, heartbeat_late: true } })
    expect(normalizeAlertConfig({ enabled: true, warnings: { mcp_tools_changed: true, heartbeat_late: false } })).toEqual({ enabled: true })
  })
})
