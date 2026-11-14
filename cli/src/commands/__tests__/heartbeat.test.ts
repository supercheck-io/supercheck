import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals'

const TOKEN = `hb_${'0f'.repeat(16)}`
const BASE = `https://app.example.com/api/heartbeat/${TOKEN}`

const stdout: string[] = []
jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk)); return true })
jest.spyOn(console, 'error').mockImplementation(() => undefined)
const realFetch = global.fetch
const mockFetch = jest.fn<typeof fetch>()
global.fetch = mockFetch
afterAll(() => { global.fetch = realFetch })

const { heartbeatCommand, buildPingRequestUrl } = await import('../heartbeat.js')
const { setOutputFormat } = await import('../../output/formatter.js')
const { setMachineMode } = await import('../../utils/logger.js')
const { ExitCode } = await import('../../utils/errors.js')

function reset(command: import('commander').Command): void {
  for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  for (const child of command.commands) reset(child)
}
const ping = (...args: string[]) => heartbeatCommand.parseAsync(['node', 'heartbeat', 'ping', ...args])
async function failure(promise: Promise<unknown>): Promise<{ message: string; exitCode: number }> {
  try { await promise } catch (error) { return error as { message: string; exitCode: number } }
  throw new Error('expected a failure')
}

beforeEach(() => {
  stdout.length = 0
  mockFetch.mockReset()
  reset(heartbeatCommand)
  setOutputFormat('table'); setMachineMode(false)
})

describe('buildPingRequestUrl', () => {
  it('adds /start or /fail and drops query and fragment', () => {
    expect(buildPingRequestUrl(BASE).toString()).toBe(BASE)
    expect(buildPingRequestUrl(`${BASE}/`, 'start').toString()).toBe(`${BASE}/start`)
    expect(buildPingRequestUrl(`${BASE}?x=1#y`, 'fail').toString()).toBe(`${BASE}/fail`)
  })

  it('keeps a pasted /start or /fail suffix and rejects a contradicting flag', () => {
    expect(buildPingRequestUrl(`${BASE}/fail`).toString()).toBe(`${BASE}/fail`)
    expect(buildPingRequestUrl(`${BASE}/start`, 'start').toString()).toBe(`${BASE}/start`)
    expect(() => buildPingRequestUrl(`${BASE}/fail`, 'start')).toThrow('/fail')
  })

  it.each([
    'not a url',
    'ftp://app.example.com/api/heartbeat/' + TOKEN,
    'https://app.example.com/api/monitors/' + TOKEN,
    'https://app.example.com/api/heartbeat/hb_short',
    `https://app.example.com/api/heartbeat/${TOKEN}/other`,
    `https://user:pw@app.example.com/api/heartbeat/${TOKEN}`,
  ])('rejects %p without echoing the token', (raw) => {
    let message = ''
    try { buildPingRequestUrl(raw) } catch (error) { message = (error as Error).message }
    expect(message).toContain('Invalid ping URL')
    expect(message).not.toContain(TOKEN)
  })
})

describe('heartbeat ping', () => {
  it('sends one POST and exits 0 on 2xx', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    await ping(BASE)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toBe(BASE)
    expect(init?.method).toBe('POST')
  })

  it('--start and --fail hit their endpoints', async () => {
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    await ping(BASE, '--start')
    reset(heartbeatCommand)
    await ping(BASE, '--fail')
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([`${BASE}/start`, `${BASE}/fail`])
  })

  it('--json reports the kind and HTTP status', async () => {
    setOutputFormat('json'); setMachineMode(true)
    mockFetch.mockResolvedValue(new Response('OK', { status: 200 }))
    await ping(BASE, '--fail')
    expect(JSON.parse(stdout.join(''))).toEqual({ sent: true, kind: 'fail', httpStatus: 200 })
  })

  it('rejects --start with --fail before any request', async () => {
    await expect(ping(BASE, '--start', '--fail')).rejects.toThrow('either --start or --fail')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([429, 500, 404])('HTTP %i exits with the API error code and no token', async (status) => {
    mockFetch.mockResolvedValue(new Response('no', { status }))
    const error = await failure(ping(BASE))
    expect(error.exitCode).toBe(ExitCode.ApiError)
    expect(error.message).toContain(String(status))
    expect(error.message).not.toContain(TOKEN)
  })

  it('a timeout exits with the timeout code', async () => {
    mockFetch.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    const error = await failure(ping(BASE))
    expect(error.exitCode).toBe(ExitCode.Timeout)
    expect(error.message).not.toContain(TOKEN)
  })

  it('a network error is non-zero and does not repeat the URL', async () => {
    mockFetch.mockRejectedValue(new TypeError(`fetch failed for ${BASE}`))
    const error = await failure(ping(BASE))
    expect(error.exitCode).toBe(ExitCode.GeneralError)
    expect(error.message).not.toContain(TOKEN)
  })
})
