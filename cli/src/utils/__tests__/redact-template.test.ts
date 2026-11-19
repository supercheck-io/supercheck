import { describe, it, expect } from '@jest/globals'
import { redact, templateHoldsCredential } from '../redact.js'

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
  it('masks by field name, not by a trailing substring: monkey and turkey stay readable', () => {
    const template = JSON.stringify({ monkey: 'banana', turkey: 'gobble', apiKey: 'k-12345', 'x-token': 't-9', password: 'p@ss' })
    const out = JSON.stringify(redact({ type: 'webhook', config: { bodyTemplate: template } }))
    expect(out).toContain('banana')
    expect(out).toContain('gobble')
    for (const secret of ['k-12345', 't-9', 'p@ss']) expect(out).not.toContain(secret)
  })

  it('reports whether a template holds a literal credential', () => {
    expect(templateHoldsCredential(bodyTemplate)).toBe(true)
    expect(templateHoldsCredential('{"routing_key":"REPLACE_WITH_PAGERDUTY_ROUTING_KEY"}')).toBe(false)
    expect(templateHoldsCredential('{"routing_key":"{{key}}","monkey":"x"}')).toBe(false)
  })
})
