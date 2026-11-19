import { afterEach, describe, expect, it } from '@jest/globals'
import { prepareBodyForApi } from '../deploy.js'
import { ExitCode } from '../../utils/errors.js'

const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const provider = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'webhook', config: { preset: 'pagerduty', ...extra } })

describe('deploy of a PagerDuty provider pulled without its template', () => {
  afterEach(() => { delete process.env.PAGERDUTY_ROUTING_KEY })

  it('takes PAGERDUTY_ROUTING_KEY when it creates the provider', () => {
    process.env.PAGERDUTY_ROUTING_KEY = KEY
    const body = prepareBodyForApi('notificationProvider', provider('On call'), 'create')
    expect(JSON.parse((body.config as { bodyTemplate: string }).bodyTemplate).routing_key).toBe(KEY)
  })

  it('explains what to set when a create has no key, instead of the server placeholder error', () => {
    expect(() => prepareBodyForApi('notificationProvider', provider('On call'), 'create')).toThrow(expect.objectContaining({ exitCode: ExitCode.ConfigError, message: expect.stringContaining('PAGERDUTY_ROUTING_KEY') }))
  })

  it('never overwrites the saved keys of existing providers on an update, whatever the variable holds', () => {
    process.env.PAGERDUTY_ROUTING_KEY = KEY
    for (const name of ['Service A', 'Service B']) {
      expect(prepareBodyForApi('notificationProvider', provider(name), 'update').config).not.toHaveProperty('bodyTemplate')
    }
  })

  it('leaves a provider that declares its own template alone', () => {
    process.env.PAGERDUTY_ROUTING_KEY = KEY
    const body = prepareBodyForApi('notificationProvider', provider('On call', { bodyTemplate: '{"routing_key":"mine"}' }), 'create')
    expect((body.config as { bodyTemplate: string }).bodyTemplate).toBe('{"routing_key":"mine"}')
  })
})
