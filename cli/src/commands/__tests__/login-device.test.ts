import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const get = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const getClient = jest.fn<(...args: unknown[]) => { get: typeof get }>(() => ({ get }))
const output = jest.fn()
let token: string | null = null
let storedUrl: string | null = null
let format = 'json'
jest.unstable_mockModule('../../auth/store.js', () => ({
  getToken: () => token, getStoredBaseUrl: () => storedUrl, setCredentials: jest.fn(),
}))
jest.unstable_mockModule('../../api/client.js', () => ({ getApiClient: getClient }))
jest.unstable_mockModule('../../output/formatter.js', () => ({ getOutputFormat: () => format }))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output, info: jest.fn(), success: jest.fn(), warn: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ createSpinner: () => ({ start: jest.fn(), stop: jest.fn() }) }))
const { runDeviceLogin } = await import('../login-device.js')
const { ApiRequestError } = await import('../../utils/errors.js')
import type { LoginDeps } from '../../auth/device-login.js'

const pendingGrant = {
  deviceCode: 'd'.repeat(43), userCode: 'BCDF-GHJK', verificationUri: 'https://app.example.com/device', expiresIn: 900, interval: 5,
}
function deps(): LoginDeps & { requestCode: jest.Mock<LoginDeps['requestCode']> } {
  let saved: Parameters<LoginDeps['store']['save']>[0] | null = null
  return {
    now: () => 1_700_000_000_000,
    store: { load: () => saved, save: (p) => { saved = p }, clear: () => { saved = null }, withLock: (fn) => fn() },
    requestCode: jest.fn<LoginDeps['requestCode']>(async () => pendingGrant),
    pollToken: jest.fn<LoginDeps['pollToken']>(async () => ({ kind: 'pending' })),
    finalize: jest.fn<LoginDeps['finalize']>(async () => ({ verified: true })),
  }
}

beforeEach(() => {
  jest.resetAllMocks()
  getClient.mockReturnValue({ get })
  token = null; storedUrl = null; format = 'json'
  delete process.env.SUPERCHECK_TOKEN
})

describe('device login selection', () => {
  it('never sends a stored token to a different host than the one it was issued for', async () => {
    token = 'sck_live_' + 'a'.repeat(32)
    storedUrl = 'https://app.supercheck.io'
    const d = deps()
    await runDeviceLogin({ url: 'https://evil.example' }, d)
    expect(get).not.toHaveBeenCalled()
    expect(getClient).not.toHaveBeenCalled()
    expect(d.requestCode).toHaveBeenCalledWith('https://evil.example')
  })

  it('short-circuits when the stored token is valid for the same host', async () => {
    token = 'sck_live_' + 'a'.repeat(32)
    storedUrl = 'https://app.example.com'
    get.mockResolvedValue({ data: { project: { id: 'p', name: 'P' } } })
    const d = deps()
    await runDeviceLogin({}, d)
    expect(d.requestCode).not.toHaveBeenCalled()
    expect(JSON.parse(String(output.mock.calls[0][0]))).toMatchObject({ authenticated: true })
  })

  it('falls through to browser login when the stored token is rejected', async () => {
    token = 'sck_live_' + 'a'.repeat(32)
    storedUrl = 'https://app.example.com'
    get.mockRejectedValue(new ApiRequestError('nope', 401))
    const d = deps()
    await runDeviceLogin({}, d)
    expect(d.requestCode).toHaveBeenCalled()
  })

  it('refuses to start when SUPERCHECK_TOKEN would shadow the new login', async () => {
    process.env.SUPERCHECK_TOKEN = 'sck_live_' + 'b'.repeat(32)
    token = process.env.SUPERCHECK_TOKEN
    storedUrl = 'https://app.example.com'
    get.mockRejectedValue(new ApiRequestError('nope', 401))
    const d = deps()
    await expect(runDeviceLogin({}, d)).rejects.toMatchObject({ exitCode: 2 })
    expect(d.requestCode).not.toHaveBeenCalled()
  })

  it('keeps a self-hosted sub-path in the API target', async () => {
    const d = deps()
    await runDeviceLogin({ url: 'https://host.example.com/supercheck/' }, d)
    expect(d.requestCode).toHaveBeenCalledWith('https://host.example.com/supercheck')
  })

  it('emits the pending JSON contract with exit 0 and no device secret', async () => {
    const d = deps()
    await runDeviceLogin({ url: 'https://app.example.com' }, d)
    const out = String(output.mock.calls[0][0])
    expect(JSON.parse(out)).toMatchObject({
      schemaVersion: '1.0', state: 'authorization_pending', authenticated: false,
      next: { action: 'authorize', userCode: 'BCDF-GHJK', url: 'https://app.example.com/device' },
    })
    expect(out).not.toContain(pendingGrant.deviceCode)
  })

  it('exits non-zero for pending in non-JSON, non-interactive mode so scripts stop', async () => {
    format = 'table'
    const d = deps()
    await expect(runDeviceLogin({ url: 'https://app.example.com' }, d)).rejects.toMatchObject({ exitCode: 2 })
  })

  it('rejects insecure API URLs', async () => {
    await expect(runDeviceLogin({ url: 'http://app.example.com' }, deps())).rejects.toMatchObject({ exitCode: 3 })
  })
})

describe('login --wait in JSON mode', () => {
  it('prints the URL and code as the first JSON line, then the result, so an agent can show the code', async () => {
    let offset = 0
    const d = deps()
    d.now = () => (offset += 2000, 1_700_000_000_000 + offset)
    d.requestCode.mockResolvedValue({ ...pendingGrant, interval: 1 })
    d.pollToken = jest.fn<LoginDeps['pollToken']>(async () => ({
      kind: 'success', accessToken: 'sck_live_' + 'a'.repeat(32), expiresIn: 7776000, context: { project: { id: 'p', name: 'P' } },
    }))
    await runDeviceLogin({ url: 'https://app.example.com', wait: true, browser: false }, d)
    const lines = output.mock.calls.map((c) => JSON.parse(String(c[0])))
    expect(lines[0]).toMatchObject({ state: 'authorization_pending', next: { userCode: 'BCDF-GHJK', url: 'https://app.example.com/device' } })
    expect(lines.at(-1)).toMatchObject({ state: 'authenticated', authenticated: true })
    expect(JSON.stringify(lines)).not.toContain(pendingGrant.deviceCode)
  }, 15000)
})

