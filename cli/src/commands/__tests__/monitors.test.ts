import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const MONITOR_ID = '019a0000-0000-7000-8000-0000000000a1'
const TOKEN = `hb_${'a1'.repeat(16)}`
const PING_URL = `https://app.example.com/api/heartbeat/${TOKEN}`

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const stdout: string[] = []
jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => { stdout.push(String(chunk).replace(/\n$/, '')); return true })
jest.spyOn(console, 'error').mockImplementation(() => undefined)

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, patch: mockPatch }),
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

const { setMachineMode } = await import('../../utils/logger.js')
const { monitorCommand, parseDurationMinutes } = await import('../monitors.js')
const { setOutputFormat } = await import('../../output/formatter.js')
const { ExitCode } = await import('../../utils/errors.js')

function reset(command: import('commander').Command): void {
  for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  for (const child of command.commands) reset(child)
}
const run = (...args: string[]) => monitorCommand.parseAsync(['node', 'monitor', ...args])
const json = () => JSON.parse(stdout.join('\n'))
const format = (value: 'table' | 'json' | 'quiet') => { setOutputFormat(value); setMachineMode(value === 'json') }

beforeEach(() => {
  stdout.length = 0
  mockGet.mockReset(); mockPost.mockReset(); mockPatch.mockReset()
  reset(monitorCommand)
  format('table')
})

describe('parseDurationMinutes', () => {
  it('converts m/h/d and bare minutes', () => {
    expect(parseDurationMinutes('5m', '--every', 44640)).toBe(5)
    expect(parseDurationMinutes('1h', '--every', 44640)).toBe(60)
    expect(parseDurationMinutes('1d', '--every', 44640)).toBe(1440)
    expect(parseDurationMinutes('31d', '--every', 44640)).toBe(44640)
    expect(parseDurationMinutes('90', '--every', 44640)).toBe(90)
  })
  it.each(['0m', '44641m', '32d', '1w', '', '-5m', '1.5h'])('rejects %p', (value) => {
    expect(() => parseDurationMinutes(value, '--every', 44640)).toThrow(expect.objectContaining({ exitCode: ExitCode.ConfigError }))
  })
})

describe('monitor create --type heartbeat', () => {
  it('sends interval and grace in minutes with an empty target', async () => {
    mockPost.mockResolvedValue({ data: { id: MONITOR_ID, type: 'heartbeat', heartbeat: { pingUrl: PING_URL, state: 'pending' } } })
    await run('create', '--name', 'Nightly', '--type', 'heartbeat', '--every', '1h', '--grace', '10m')
    expect(mockPost).toHaveBeenCalledWith('/api/monitors', { name: 'Nightly', target: '', type: 'heartbeat', frequencyMinutes: 60, config: { heartbeat: { graceMinutes: 10 } } })
  })

  it('omits grace when not given', async () => {
    mockPost.mockResolvedValue({ data: { id: MONITOR_ID } })
    await run('create', '--name', 'Nightly', '--type', 'heartbeat', '--every', '1d')
    expect(mockPost.mock.calls[0][1]).toMatchObject({ frequencyMinutes: 1440, config: {} })
  })

  it('prints the ping URL once on stdout in table mode', async () => {
    mockPost.mockResolvedValue({ data: { id: MONITOR_ID, type: 'heartbeat', heartbeat: { pingUrl: PING_URL, state: 'pending' } } })
    await run('create', '--name', 'Nightly', '--type', 'heartbeat', '--every', '1h')
    expect(stdout.join('\n').split(PING_URL)).toHaveLength(2)
  })

  it('returns heartbeat.pingUrl in --json', async () => {
    format('json')
    mockPost.mockResolvedValue({ data: { id: MONITOR_ID, type: 'heartbeat', heartbeat: { pingUrl: PING_URL, state: 'pending' } } })
    await run('create', '--name', 'Nightly', '--type', 'heartbeat', '--every', '1h')
    expect(json()).toMatchObject({ id: MONITOR_ID, heartbeat: { pingUrl: PING_URL, state: 'pending' } })
  })

  it.each([
    [['--every', '0m'], '--every'],
    [['--every', '44641m'], '--every'],
    [['--every', '1h', '--grace', '0m'], '--grace'],
    [['--every', '1h', '--grace', '1441m'], '--grace'],
    [['--every', '1h', '--url', 'https://example.com'], '--url'],
    [[], '--every'],
  ])('rejects %p before any request', async (args, flag) => {
    await expect(run('create', '--name', 'N', '--type', 'heartbeat', ...args)).rejects.toThrow(flag)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects --every on other monitor types', async () => {
    await expect(run('create', '--name', 'N', '--url', 'https://example.com', '--every', '1h')).rejects.toThrow('only to --type heartbeat')
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('monitor update heartbeat fields', () => {
  it('sends --every and --grace in minutes', async () => {
    mockPatch.mockResolvedValue({ data: { id: MONITOR_ID } })
    await run('update', MONITOR_ID, '--every', '2d', '--grace', '2h')
    expect(mockPatch).toHaveBeenCalledWith(`/api/monitors/${MONITOR_ID}`, { frequencyMinutes: 2880, config: { heartbeat: { graceMinutes: 120 } } })
  })
})

describe('monitor heartbeat-url', () => {
  it('reveals with GET', async () => {
    mockGet.mockResolvedValue({ data: { pingUrl: PING_URL } })
    await run('heartbeat-url', MONITOR_ID)
    expect(mockGet).toHaveBeenCalledWith(`/api/monitors/${MONITOR_ID}/heartbeat-url`)
    expect(stdout.join('\n')).toContain(PING_URL)
  })

  it('rotates with one POST and no retries', async () => {
    format('json')
    mockPost.mockResolvedValue({ data: { pingUrl: PING_URL } })
    await run('heartbeat-url', MONITOR_ID, '--rotate', '--force')
    expect(mockPost).toHaveBeenCalledWith(`/api/monitors/${MONITOR_ID}/heartbeat-url/rotate`, {}, { retries: 0 })
    expect(json()).toEqual({ id: MONITOR_ID, pingUrl: PING_URL })
  })

  it('needs --force to rotate non-interactively', async () => {
    format('json')
    await expect(run('heartbeat-url', MONITOR_ID, '--rotate')).rejects.toThrow('CONFIRMATION_REQUIRED')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('prints only the URL in quiet mode', async () => {
    format('quiet')
    mockGet.mockResolvedValue({ data: { pingUrl: PING_URL } })
    await run('heartbeat-url', MONITOR_ID)
    expect(stdout).toEqual([PING_URL])
  })
})

describe('monitor list and get', () => {
  const row = { id: MONITOR_ID, name: 'Nightly', type: 'heartbeat', status: 'up', frequencyMinutes: 60, heartbeat: { state: 'late', lastPingAt: '2026-11-14T10:00:00.000Z', lastPingKind: 'ping', lastStartAt: null, nextExpectedAt: '2026-11-14T11:12:00.000Z', graceMinutes: 12 } }

  it('table shows heartbeat state, interval with grace and last ping', async () => {
    mockGet.mockResolvedValue({ data: { data: [row], pagination: null } })
    await run('list')
    const text = stdout.join('\n')
    expect(text).toContain('late')
    expect(text).toContain('60 (grace 12)')
    expect(text).toContain('Last ping')
  })

  it('--json passes the heartbeat object through unchanged', async () => {
    format('json')
    mockGet.mockResolvedValue({ data: { data: [row], pagination: null } })
    await run('list')
    expect(json()).toEqual([row])
  })

  it('get --json keeps the heartbeat summary and masks a ping URL in free text', async () => {
    format('json')
    mockGet.mockResolvedValue({ data: { ...row, description: `pinged at ${PING_URL}` } })
    await run('get', MONITOR_ID)
    const out = stdout.join('\n')
    expect(json().heartbeat).toEqual(row.heartbeat)
    expect(out).not.toContain(TOKEN)
  })
})
