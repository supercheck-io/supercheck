import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockDelete = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, patch: mockPatch, delete: mockDelete }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({ output: mockOutput, outputDetail: mockOutputDetail, getOutputFormat: () => 'json' }))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), success: mockSuccess, warn: mockWarn, error: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_t: string, fn: () => Promise<unknown>) => fn() }))

const { maintenanceCommand, parseDuration } = await import('../maintenance.js')
const { ApiRequestError } = await import('../../utils/errors.js')

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

  it('lists by service and gets one window', async () => {
    mockGet.mockResolvedValue({ data: { windows: [], window: { id: id(9) } } })
    await run('list', '--service', id(2))
    expect(mockGet).toHaveBeenCalledWith('/api/maintenance-windows', { serviceId: id(2) })
    await run('get', id(9))
    expect(mockGet).toHaveBeenLastCalledWith(`/api/maintenance-windows/${id(9)}`)
    expect(mockOutputDetail).toHaveBeenCalledWith({ id: id(9) })
    await expect(run('list', '--service', 'x')).rejects.toThrow('service UUID')
  })

  it('says the server is too old on a bare 404, and passes a JSON 404 through', async () => {
    mockGet.mockRejectedValueOnce(new ApiRequestError('not found', 404, undefined))
    await expect(run('list')).rejects.toThrow('newer Supercheck server')
    mockGet.mockRejectedValueOnce(new ApiRequestError('not found', 404, { error: 'Maintenance window not found' }))
    await expect(run('get', id(9))).rejects.toThrow('not found')
  })

  it('shows the server 402 message when the plan has lapsed', async () => {
    const message = 'Active subscription required. Visit /billing to subscribe to Plus or Pro.'
    mockPost.mockRejectedValueOnce(new ApiRequestError('API request failed: POST /api/maintenance-windows → 402', 402, { error: message, code: 'subscription_required' }))
    await expect(run('extend', id(9), '--by', '30')).rejects.toMatchObject({ message, statusCode: 402 })
  })

  it('extends to a strict ISO time and needs exactly one of --by or --to', async () => {
    mockPost.mockResolvedValue({ data: { window: { id: id(9) } } })
    await run('extend', id(9), '--to', '2026-11-20T04:00:00Z')
    expect(mockPost).toHaveBeenCalledWith(`/api/maintenance-windows/${id(9)}/extend`, { until: '2026-11-20T04:00:00.000Z' }, { retries: 0 })
    await run('extend', id(9), '--to', '2026-11-20T04:00+02:00')
    expect(mockPost).toHaveBeenLastCalledWith(expect.any(String), { until: '2026-11-20T02:00:00.000Z' }, { retries: 0 })
    // No offset means the user's local time, sent to the server as UTC.
    await run('extend', id(9), '--to', '2026-11-20T04:00')
    expect(mockPost).toHaveBeenLastCalledWith(expect.any(String), { until: new Date('2026-11-20T04:00').toISOString() }, { retries: 0 })
    expect(mockPost).toHaveBeenCalledTimes(3)
    await expect(run('extend', id(9))).rejects.toThrow('exactly one')
    await expect(run('extend', id(9), '--by', '1h', '--to', '2026-11-20T04:00:00Z')).rejects.toThrow('exactly one')
    for (const bad of ['soon', '2', '2026-11-20', 'Nov 20 2026', '2026-02-30T04:00', '2026-13-01T04:00', '2026-11-20T24:00', '2026-11-20T04:00+99:99']) {
      await expect(run('extend', id(9), '--to', bad)).rejects.toThrow('ISO 8601')
    }
    expect(mockPost).toHaveBeenCalledTimes(3)
  })

  it('updates only the fields passed and rejects an empty update', async () => {
    mockPatch.mockResolvedValue({ data: { window: { id: id(9) } } })
    await run('update', id(9), '--title', 'New', '--duration', '2h', '--start', '2026-11-21 03:00', '--service', id(2))
    expect(mockPatch).toHaveBeenCalledWith(`/api/maintenance-windows/${id(9)}`, {
      title: 'New', scope: 'services', targets: { serviceIds: [id(2)], monitorIds: [] }, startsOn: '2026-11-21', localStartTime: '03:00', durationMinutes: 120,
    })
    await expect(run('update', id(9))).rejects.toThrow('at least one field')
    await expect(run('update', id(9), '--project', '--monitor', id(1))).rejects.toThrow('one scope')
    await expect(run('update', id(9), '--monitor', 'm')).rejects.toThrow()
    expect(mockPatch).toHaveBeenCalledTimes(1)
    await run('update', id(9), '--project')
    expect(mockPatch.mock.calls[1]![1]).toMatchObject({ scope: 'project' })
    await run('update', id(9), '--monitor', id(1))
    expect(mockPatch.mock.calls[2]![1]).toMatchObject({ scope: 'monitors', targets: { monitorIds: [id(1)] } })
    await run('update', id(9), '--repeat', 'weekly', '--days', 'mon,thu')
    expect(mockPatch.mock.calls[3]![1]).toMatchObject({ recurrence: 'weekly', weekdays: [1, 4] })
    await run('update', id(9), '--repeat', 'monthly', '--day', 'last')
    expect(mockPatch.mock.calls[4]![1]).toMatchObject({ recurrence: 'monthly', monthDay: -1 })
    expect(mockPatch).toHaveBeenCalledTimes(5)
    await run('update', id(9), '--until', 'none')
    expect(mockPatch.mock.calls[5]![1]).toEqual({ endsOn: null })
  })
})
