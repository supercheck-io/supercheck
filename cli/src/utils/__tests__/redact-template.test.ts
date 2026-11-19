import { describe, it, expect } from '@jest/globals'
import { redact } from '../redact.js'

describe('redact webhook body templates', () => {
  const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
  const bodyTemplate = JSON.stringify({ routing_key: KEY, event_action: '{{pagerDutyEventAction}}', dedup_key: '{{dedupKey}}', payload: { summary: '{{title}}', source: 'supercheck' } }, null, 2)

  it('masks a literal routing key in a provider response and keeps the placeholders', () => {
    const out = JSON.stringify(redact({ id: 'np-1', type: 'webhook', config: { preset: 'pagerduty', bodyTemplate } }))
    expect(out).not.toContain(KEY)
    expect(out).toContain('[REDACTED]')
    expect(out).toContain('{{pagerDutyEventAction}}')
    expect(out).toContain('supercheck')
  })

  it('leaves the preset placeholder text for other keys alone', () => {
    const out = JSON.stringify(redact({ type: 'webhook', config: { bodyTemplate: JSON.stringify({ routing_key: '{{key}}' }) } }))
    expect(out).toContain('{{key}}')
  })
})
