import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPut = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, put: mockPut, delete: jest.fn() }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  outputMutation: jest.fn(),
  getOutputFormat: () => 'json',
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), newline: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))
jest.unstable_mockModule('../../utils/prompt.js', () => ({ confirmPrompt: jest.fn() }))

const { notificationCommand } = await import('../notifications.js')
const { incidentCommand, describeNotificationEvent } = await import('../incidents.js')
const { ExitCode, ApiRequestError } = await import('../../utils/errors.js')

function resetCommandState(command: import('commander').Command): void {
  for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  for (const child of command.commands) resetCommandState(child)
}

const CHANNEL = '018f0000-0000-7000-8000-0000000000c1'
const MEMBER = '018f0000-0000-7000-8000-0000000000a1'
const policy = {
  channelIds: [CHANNEL], emailServiceOwnersOnSev12: false, autoInvestigateOnOpen: false,
  renotifyUnackedMinutes: 15, renotifyRepeatMinutes: null, renotifyMax: 3,
  escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null,
  autoInvestigateEnabledAt: null,
}

beforeEach(() => {
  jest.resetAllMocks()
  resetCommandState(notificationCommand)
  resetCommandState(incidentCommand)
})

describe('notification test <id>', () => {
  it('sends a test page through the saved channel and prints the vendor result', async () => {
    const result = { ok: true, action: 'trigger', responseStatus: 202, dedupKey: `test:${CHANNEL}` }
    mockPost.mockResolvedValueOnce({ data: result })
    await notificationCommand.parseAsync(['node', 'notification', 'test', CHANNEL])
    expect(mockPost).toHaveBeenCalledWith(`/api/notification-providers/${CHANNEL}/test`, { action: 'trigger' }, { retries: 0 })
    expect(mockOutputDetail).toHaveBeenCalledWith(result)
  })

  it('resolves the test page with --resolve', async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: true, action: 'resolve' } })
    await notificationCommand.parseAsync(['node', 'notification', 'test', CHANNEL, '--resolve'])
    expect(mockPost).toHaveBeenCalledWith(`/api/notification-providers/${CHANNEL}/test`, { action: 'resolve' }, { retries: 0 })
  })

  it('fails with the vendor error (and still prints the result) when the page is rejected', async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: false, responseStatus: 401, error: 'Authentication rejected (HTTP 401). Check the integration key.' } })
    await expect(notificationCommand.parseAsync(['node', 'notification', 'test', CHANNEL])).rejects.toMatchObject({
      exitCode: ExitCode.GeneralError, message: 'Authentication rejected (HTTP 401). Check the integration key.',
    })
    expect(mockOutputDetail).toHaveBeenCalled()
  })

  it('names the HTTP status when the server gives no error text', async () => {
    mockPost.mockResolvedValueOnce({ data: { ok: false, responseStatus: 503 } })
    await expect(notificationCommand.parseAsync(['node', 'notification', 'test', CHANNEL])).rejects.toMatchObject({ message: 'Test failed (HTTP 503)' })
  })

  it('rejects an id combined with an unsaved configuration, and --resolve without an id', async () => {
    await expect(notificationCommand.parseAsync(['node', 'notification', 'test', CHANNEL, '--type', 'slack'])).rejects.toMatchObject({ exitCode: ExitCode.ConfigError })
    resetCommandState(notificationCommand)
    await expect(notificationCommand.parseAsync(['node', 'notification', 'test', '--resolve'])).rejects.toMatchObject({ exitCode: ExitCode.ConfigError, message: '--resolve needs a saved channel id' })
    resetCommandState(notificationCommand)
    await expect(notificationCommand.parseAsync(['node', 'notification', 'test'])).rejects.toMatchObject({ exitCode: ExitCode.ConfigError })
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows channel health as a list column without changing the JSON rows', async () => {
    const rows = [{ id: CHANNEL, health: { state: 'auth_failed', at: '2026-11-14T00:00:00Z' } }, { id: 'x' }]
    mockGet.mockResolvedValueOnce({ data: rows })
    await notificationCommand.parseAsync(['node', 'notification', 'list'])
    const [data, options] = mockOutput.mock.calls[0] as [unknown, { columns: { key: string; format?: (v: unknown, r: unknown) => string }[] }]
    expect(data).toBe(rows)
    const health = options.columns.find((column) => column.key === 'health')!
    expect(health.format!(rows[0].health, rows[0])).toBe('auth_failed')
    expect(health.format!(undefined, rows[1])).toBe('-')
  })
})

describe('incident timeline notification events', () => {
  it('describes reminders, escalations and failed pages', () => {
    expect(describeNotificationEvent({ kind: 'reminder', n: 2, of: 3, channels: [{ type: 'slack', ok: true }, { type: 'email', ok: false }], emailed: 1 })).toBe('Reminder 2 of 3 sent to 1/2 channel(s), 1 email(s)')
    expect(describeNotificationEvent({ kind: 'escalation', reached: 0, channels: [] })).toBe('Escalation target was removed; nobody was escalated to')
    expect(describeNotificationEvent({ kind: 'escalation', reached: 1, channels: [], emailed: 1 })).toBe('Escalated to 0/0 channel(s), 1 email(s)')
    expect(describeNotificationEvent({ kind: 'page_failed', preset: 'pagerduty', status: 503, fallback: 'policy_channels' })).toBe('pagerduty page failed (HTTP 503); fallback: policy_channels')
    expect(describeNotificationEvent({ kind: 'page_failed' })).toBe('Paging page failed; fallback: none')
    expect(describeNotificationEvent({ kind: 'other' })).toBe('{"kind":"other"}')
  })

  it('formats only notification rows; other events keep their JSON details', async () => {
    mockGet.mockResolvedValueOnce({ data: { events: [] } })
    await incidentCommand.parseAsync(['node', 'incident', 'timeline', '018f0000-0000-7000-8000-000000000001'])
    const options = mockOutput.mock.calls[0][1] as { columns: { key: string; format?: (v: unknown, r: Record<string, unknown>) => string }[] }
    const details = options.columns.find((column) => column.key === 'eventData')!
    expect(details.format!({ kind: 'reminder', n: 1, of: 1, channels: [] }, { eventType: 'notification' })).toBe('Reminder 1 of 1 sent to 0/0 channel(s)')
    expect(details.format!({ state: 'created' }, { eventType: 'state_change' })).toBe('{"state":"created"}')
    expect(details.format!(null, { eventType: 'comment' })).toBe('-')
  })
})

describe('incident policy', () => {
  it('get prints the current policy', async () => {
    mockGet.mockResolvedValueOnce({ data: { policy } })
    await incidentCommand.parseAsync(['node', 'incident', 'policy', 'get'])
    expect(mockGet).toHaveBeenCalledWith('/api/notification-policy')
    expect(mockOutputDetail).toHaveBeenCalledWith(policy)
  })

  it('get explains an older server without the route', async () => {
    mockGet.mockRejectedValueOnce(new ApiRequestError('Not Found', 404, '<html>'))
    await expect(incidentCommand.parseAsync(['node', 'incident', 'policy', 'get'])).rejects.toMatchObject({ exitCode: ExitCode.ApiError })
  })

  it('set merges the flags into the current policy and keeps the rest', async () => {
    mockGet.mockResolvedValueOnce({ data: { policy } })
    mockPut.mockResolvedValueOnce({ data: { policy: { ...policy, renotifyRepeatMinutes: 60 } } })
    await incidentCommand.parseAsync(['node', 'incident', 'policy', 'set', '--repeat', '60', '--max', '4', '--escalate-after', '30', '--escalate-member', MEMBER])
    const { autoInvestigateEnabledAt: _omit, ...rest } = policy
    void _omit
    expect(mockPut).toHaveBeenCalledWith('/api/notification-policy', {
      ...rest, renotifyRepeatMinutes: 60, renotifyMax: 4, escalateAfterMinutes: 30, escalateUserId: MEMBER, escalateChannelId: null,
    })
  })

  it('set off clears dependent fields so the server accepts it', async () => {
    mockGet.mockResolvedValueOnce({ data: { policy: { ...policy, renotifyRepeatMinutes: 60, escalateAfterMinutes: 30, escalateChannelId: CHANNEL } } })
    mockPut.mockResolvedValueOnce({ data: { policy } })
    await incidentCommand.parseAsync(['node', 'incident', 'policy', 'set', '--first-reminder', 'off', '--escalate-after', 'OFF'])
    expect(mockPut.mock.calls[0][1]).toMatchObject({ renotifyUnackedMinutes: null, renotifyRepeatMinutes: null, escalateAfterMinutes: null, escalateChannelId: null, escalateUserId: null })
  })

  it('set with a channel target clears the member target', async () => {
    mockGet.mockResolvedValueOnce({ data: { policy: { ...policy, escalateAfterMinutes: 30, escalateUserId: MEMBER } } })
    mockPut.mockResolvedValueOnce({ data: { policy } })
    await incidentCommand.parseAsync(['node', 'incident', 'policy', 'set', '--escalate-channel', CHANNEL])
    expect(mockPut.mock.calls[0][1]).toMatchObject({ escalateChannelId: CHANNEL, escalateUserId: null })
  })

  it.each([
    [[], 'No fields to update'],
    [['--repeat', '3'], '--repeat must be off or whole minutes from 5 to 1440'],
    [['--first-reminder', 'soon'], '--first-reminder must be off'],
    [['--max', '11'], '--max must be a whole number from 1 to 10'],
    [['--escalate-channel', CHANNEL, '--escalate-member', MEMBER], 'not both'],
    [['--escalate-member', 'bob'], 'Escalation targets must be UUIDs'],
    // Stored policy has no escalation delay: the target would be dropped silently.
    [['--escalate-channel', CHANNEL], 'Set --escalate-after as well'],
  ])('set rejects %j before saving', async (args, message) => {
    mockGet.mockResolvedValue({ data: { policy } })
    await expect(incidentCommand.parseAsync(['node', 'incident', 'policy', 'set', ...args])).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError, message: expect.stringContaining(message),
    })
    expect(mockPut).not.toHaveBeenCalled()
  })
})
