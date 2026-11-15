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

  it('masks a credential smuggled into the username but keeps the reference', () => {
    const out = redact({ name: 'API', type: 'http_request', config: { auth: { type: 'basic', username: 'https://u:p@host.example', secretKey: 'PW' } } })
    expect(out.config.auth.secretKey).toBe('PW')
    expect(out.config.auth.username).not.toContain('u:p@')
  })

  it('still masks auth that carries an inline credential', () => {
    const def = { name: 'API', type: 'http_request', config: { auth: { type: 'bearer', token: 'sk-live', secretKey: 'X' } } }
    expect(redact(def).config.auth).toBe('[REDACTED]')
  })

  it('keeps MCP custom-header and no-login auth', () => {
    const header = { name: 'MCP', type: 'mcp_server', config: { mcp: { auth: { type: 'header', secretKey: 'MCP_TOKEN', headerName: 'X-Api-Key' } } } }
    const none = { name: 'MCP', type: 'mcp_server', config: { mcp: { auth: { type: 'none' } } } }
    expect(redact(header)).toEqual(header)
    expect(redact(none)).toEqual(none)
  })

  it('still masks an MCP header auth with an inline value', () => {
    const out = redact({ name: 'MCP', type: 'mcp_server', config: { mcp: { auth: { type: 'header', headerName: 'X', token: 'v' } } } })
    expect(out.config.mcp.auth).toBe('[REDACTED]')
  })
})
