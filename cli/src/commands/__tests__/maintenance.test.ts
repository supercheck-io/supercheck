import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockDelete = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, delete: mockDelete }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({ output: mockOutput, outputDetail: mockOutputDetail, getOutputFormat: () => 'json' }))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), success: mockSuccess, warn: mockWarn, error: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_t: string, fn: () => Promise<unknown>) => fn() }))

const { maintenanceCommand, parseDuration } = await import('../maintenance.js')

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const run = (...args: string[]) => maintenanceCommand.parseAsync(['node', 'maintenance', ...args])

describe('maintenance CLI', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    for (const command of maintenanceCommand.commands) for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  })

  it('parses durations', () => {
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration('90m')).toBe(90)
    expect(parseDuration('2h')).toBe(120)
    expect(parseDuration('1h30m')).toBe(90)
    expect(() => parseDuration('soon')).toThrow('not a duration')
  })

  it('creates a one-off monitor window with one POST and no retries', async () => {
    mockPost.mockResolvedValueOnce({ data: { window: { id: id(9) } } })
    await run('create', '--title', 'Deploy', '--monitor', id(1), '--start', '2026-11-20 02:00', '--duration', '90m', '--timezone', 'Europe/Berlin')
    expect(mockPost).toHaveBeenCalledWith('/api/maintenance-windows', {
      title: 'Deploy', scope: 'monitors', targets: { serviceIds: [], monitorIds: [id(1)] }, recurrence: 'once', timezone: 'Europe/Berlin',
      startsOn: '2026-11-20', localStartTime: '02:00', durationMinutes: 90, notifySubscribers: false,
    }, { retries: 0 })
    expect(mockOutputDetail).toHaveBeenCalledWith({ id: id(9) })
  })

  it('creates weekly and monthly series and a published one-off', async () => {
    mockPost.mockResolvedValue({ data: { window: { id: id(9) } } })
    await run('create', '--title', 'Nightly', '--project', '--start', '2026-11-20 02:00', '--duration', '30', '--timezone', 'UTC', '--repeat', 'weekly', '--days', 'mon,thu', '--until', '2027-03-01')
    expect(mockPost.mock.calls[0]![1]).toMatchObject({ scope: 'project', recurrence: 'weekly', weekdays: [1, 4], endsOn: '2027-03-01' })
    await run('create', '--title', 'Month end', '--service', id(2), '--start', '2026-11-30 23:00', '--duration', '1h', '--timezone', 'UTC', '--repeat', 'monthly', '--day', 'last')
    expect(mockPost.mock.calls[1]![1]).toMatchObject({ scope: 'services', recurrence: 'monthly', monthDay: -1 })
    mockPost.mockResolvedValueOnce({ data: { window: { id: id(9) }, warning: 'status_page_failed' } })
    await run('create', '--title', 'Upgrade', '--project', '--start', '2026-11-20 02:00', '--duration', '1h', '--timezone', 'UTC', '--status-page', id(3), '--component', id(4), '--notify')
    expect(mockPost.mock.calls[2]![1]).toMatchObject({ statusPages: [{ statusPageId: id(3), componentIds: [id(4)] }], notifySubscribers: true })
    expect(mockWarn).toHaveBeenCalled()
  })

  it.each([
    [['create', '--title', 'x', '--start', '2026-11-20 02:00', '--duration', '1h'], 'exactly one scope'],
    [['create', '--title', 'x', '--project', '--monitor', id(1), '--start', '2026-11-20 02:00', '--duration', '1h'], 'exactly one scope'],
    [['create', '--title', 'x', '--monitor', 'm', '--start', '2026-11-20 02:00', '--duration', '1h'], 'not a UUID'],
    [['create', '--title', 'x', '--project', '--start', 'tomorrow', '--duration', '1h'], '--start must look like'],
    [['create', '--title', 'x', '--project', '--start', '2026-11-20 02:00', '--duration', '1h', '--repeat', 'weekly'], 'needs --days'],
    [['create', '--title', 'x', '--project', '--start', '2026-11-20 02:00', '--duration', '1h', '--repeat', 'monthly', '--day', '31'], '--day 1-28'],
    [['create', '--title', 'x', '--project', '--start', '2026-11-20 02:00', '--duration', '1h', '--repeat', 'daily', '--status-page', id(3), '--component', id(4)], 'Only one-off'],
    [['end', 'nope'], 'UUID'],
  ])('rejects %j before calling the API', async (args, message) => {
    await expect(run(...args)).rejects.toThrow(message)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('lists with filters and runs end, extend and cancel', async () => {
    mockGet.mockResolvedValueOnce({ data: { windows: [] } })
    await run('list', '--state', 'active', '--monitor', id(1))
    expect(mockGet).toHaveBeenCalledWith('/api/maintenance-windows', { state: 'active', monitorId: id(1) })
    mockPost.mockResolvedValue({ data: { window: { id: id(9) } } })
    await run('end', id(9))
    await run('extend', id(9), '--by', '30m')
    await run('cancel', id(9))
    expect(mockPost.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [`/api/maintenance-windows/${id(9)}/end`, {}],
      [`/api/maintenance-windows/${id(9)}/extend`, { byMinutes: 30 }],
      [`/api/maintenance-windows/${id(9)}/cancel`, {}],
    ])
  })

  it('refuses to delete in JSON mode without --force, deletes with it', async () => {
    await expect(run('delete', id(9))).rejects.toThrow('--force')
    mockDelete.mockResolvedValueOnce({ data: {} })
    await run('delete', id(9), '--force')
    expect(mockDelete).toHaveBeenCalledWith(`/api/maintenance-windows/${id(9)}`)
  })
})
