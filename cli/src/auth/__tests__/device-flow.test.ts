import { describe, it, expect, jest } from '@jest/globals'
import { assertSafeApiUrl, pollDeviceToken, requestDeviceCode, type FetchLike } from '../device-flow.js'

const API = 'https://app.example.com'
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const validCode = {
  device_code: 'd'.repeat(43), user_code: 'BCDF-GHJK', verification_uri: `${API}/device`,
  verification_uri_complete: `${API}/device?code=BCDF-GHJK`, expires_in: 900, interval: 5,
}

describe('assertSafeApiUrl', () => {
  it('accepts https and loopback http only', () => {
    expect(assertSafeApiUrl('https://app.example.com').origin).toBe(API)
    expect(assertSafeApiUrl('http://localhost:3000').origin).toBe('http://localhost:3000')
    expect(assertSafeApiUrl('http://127.0.0.1:3000').protocol).toBe('http:')
    expect(() => assertSafeApiUrl('http://app.example.com')).toThrow(/https/)
    expect(() => assertSafeApiUrl('https://user:pw@app.example.com')).toThrow(/credentials/)
    expect(() => assertSafeApiUrl('ftp://app.example.com')).toThrow()
    expect(() => assertSafeApiUrl('not a url')).toThrow()
  })
})

describe('requestDeviceCode', () => {
  it('sends a form request with no Authorization and refuses redirects', async () => {
    const fetchImpl = jest.fn<FetchLike>(async () => json(200, validCode))
    const result = await requestDeviceCode(API, fetchImpl)
    expect(result).toMatchObject({ userCode: 'BCDF-GHJK', interval: 5, expiresIn: 900 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url.toString()).toBe(`${API}/api/auth/device/code`)
    expect(init.redirect).toBe('error')
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i)
    expect(String(init.body)).toContain('client_id=supercheck-cli')
  })

  it('rejects verification URIs on another origin and malformed responses', async () => {
    await expect(requestDeviceCode(API, async () => json(200, { ...validCode, verification_uri: 'https://evil.example/device' }))).rejects.toThrow(/malformed|different host/)
    await expect(requestDeviceCode(API, async () => json(200, { ...validCode, device_code: 'short' }))).rejects.toThrow(/malformed/)
    // A foreign "complete" URI is dropped rather than trusted.
    const out = await requestDeviceCode(API, async () => json(200, { ...validCode, verification_uri_complete: 'https://evil.example/x' }))
    expect(out.verificationUriComplete).toBeUndefined()
  })

  it('falls back to token instructions when the server has device login disabled', async () => {
    await expect(requestDeviceCode(API, async () => json(503, { error: 'device_auth_disabled' }))).rejects.toThrow(/AUTH_REQUIRED/)
    await expect(requestDeviceCode(API, async () => json(404, {}))).rejects.toThrow(/AUTH_REQUIRED/)
  })

  it('wraps network failures without leaking request content', async () => {
    const error = await requestDeviceCode(API, async () => { throw new TypeError('fetch failed') }).catch((e: Error) => e)
    expect((error as Error).message).toContain('Could not reach')
  })
})

describe('pollDeviceToken', () => {
  const poll = (status: number, body: unknown) => pollDeviceToken(API, 'x'.repeat(43), async () => json(status, body))

  it.each([
    [400, { error: 'authorization_pending', interval: 5 }, 'pending'],
    [400, { error: 'slow_down', interval: 10 }, 'slow_down'],
    [400, { error: 'access_denied' }, 'denied'],
    [400, { error: 'expired_token' }, 'expired'],
    [400, { error: 'invalid_grant' }, 'consumed'],
    [409, { error: 'token_limit_reached' }, 'token_limit'],
    [503, { error: 'device_auth_disabled' }, 'disabled'],
    [429, { error: 'slow_down', interval: 30 }, 'slow_down'],
  ])('maps %i %p to %s', async (status, body, kind) => {
    expect((await poll(status, body)).kind).toBe(kind)
  })

  it('validates a successful credential strictly', async () => {
    const ok = await poll(200, { access_token: 'sck_live_' + 'a'.repeat(32), token_type: 'Bearer', expires_in: 7776000, context: { project: { id: 'p' } } })
    expect(ok).toMatchObject({ kind: 'success', expiresIn: 7776000 })
    await expect(poll(200, { access_token: 'not-a-key', token_type: 'Bearer' })).rejects.toThrow(/unusable/)
    await expect(poll(200, { access_token: 'sck_live_' + 'a'.repeat(32), token_type: 'MAC' })).rejects.toThrow(/unusable/)
    await expect(poll(400, { error: 'invalid_client' })).rejects.toThrow(/Device login failed/)
  })

  it('does not echo the device code in errors', async () => {
    const error = await pollDeviceToken(API, 'SECRETDEVICECODE'.repeat(3), async () => json(500, { error: 'boom' })).catch((e: Error) => e)
    expect((error as Error).message).not.toContain('SECRETDEVICECODE')
  })
})
