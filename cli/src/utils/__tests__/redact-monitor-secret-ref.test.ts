import { describe, it, expect } from '@jest/globals'
import { redact } from '../redact.js'

describe('monitor secret references survive redaction', () => {
  it('keeps auth that only names a project secret, so pull then deploy round-trips', () => {
    const def = { name: 'API', type: 'http_request', config: { auth: { type: 'bearer', secretKey: 'API_TOKEN' }, aiEndpoint: { model: 'm', secretKey: 'OPENAI_KEY' } } }
    expect(redact(def)).toEqual(def)
  })

  it('keeps basic auth whose password comes from a secret', () => {
    const def = { name: 'API', type: 'http_request', config: { auth: { type: 'basic', username: 'me', secretKey: 'API_PASSWORD' } } }
    expect(redact(def)).toEqual(def)
  })

  it('still masks auth that carries an inline credential', () => {
    const def = { name: 'API', type: 'http_request', config: { auth: { type: 'bearer', token: 'sk-live', secretKey: 'X' } } }
    expect(redact(def).config.auth).toBe('[REDACTED]')
  })
})
