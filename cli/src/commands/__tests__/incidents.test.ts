import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockFormat = jest.fn(() => 'json')
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, patch: mockPatch, getBaseUrl: () => 'https://app.example.com' }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  getOutputFormat: () => mockFormat(),
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), success: mockSuccess, warn: mockWarn, error: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

const { incidentCommand } = await import('../incidents.js')
const { ApiRequestError } = await import('../../utils/errors.js')

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const run = (...args: string[]) => incidentCommand.parseAsync(['node', 'incident', 'create', ...args])

describe('incident create', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockFormat.mockReturnValue('json')
    // Commander keeps option values between parses; start each test from the defaults.
    const create = incidentCommand.commands.find((command) => command.name() === 'create')!
    for (const option of create.options) create.setOptionValue(option.attributeName(), option.defaultValue)
  })

  it('posts the minimal body once, without retries, and prints the incident', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, incident: { id: id(9), incidentNumber: 12, title: 'Checkout down' } } })
    await run('--title', 'Checkout down')
    expect(mockPost).toHaveBeenCalledWith('/api/sre/incidents', { title: 'Checkout down', severity: 'sev3', affected: { serviceIds: [], monitorIds: [] } }, { retries: 0 })
    expect(mockSuccess).toHaveBeenCalledWith('Incident #12 declared')
    expect(mockOutputDetail).toHaveBeenCalledWith({ id: id(9), incidentNumber: 12, title: 'Checkout down' })
  })

  it('resolves a service by name, takes repeatable monitors, a commander and a status page', async () => {
    mockGet.mockResolvedValueOnce({ data: { services: [{ id: id(4), name: 'Checkout API' }, { id: id(5), name: 'Search' }] } })
    mockPost.mockResolvedValueOnce({ data: { success: true, incident: { id: id(9), incidentNumber: 3 }, statusPageIncidentId: id(30) } })
    await run('--title', 'Down', '--severity', 'sev1', '--summary', 'Users report 500s', '--service', 'checkout api',
      '--monitor', id(6), '--monitor', id(7), '--commander', id(8), '--status-page', id(20), '--component', id(21),
      '--impact', 'major', '--message', 'Investigating', '--notify')
    expect(mockPost).toHaveBeenCalledWith('/api/sre/incidents', {
      title: 'Down', severity: 'sev1', summary: 'Users report 500s', primaryServiceId: id(4),
      affected: { serviceIds: [], monitorIds: [id(6), id(7)] }, commanderUserId: id(8),
      statusPage: { statusPageId: id(20), componentIds: [id(21)], impact: 'major', message: 'Investigating', notifySubscribers: true },
    }, { retries: 0 })
    expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ statusPageIncidentId: id(30) }))
  })

  it('warns when the incident was created but the status page post failed', async () => {
    mockPost.mockResolvedValueOnce({ data: { success: true, incident: { id: id(9), incidentNumber: 3 }, warning: 'status_page_failed' } })
    await run('--title', 'Down', '--status-page', id(20), '--component', id(21))
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('status page failed'))
    expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ warning: 'status_page_failed' }))
  })

  it.each([
    [['--title', 'x', '--monitor', 'nope'], 'is not a UUID'],
    [['--title', 'x', '--component', id(21)], '--component needs --status-page'],
    [['--title', 'x', '--status-page', id(20)], 'needs at least one --component'],
    [['--title', 'x', '--notify'], '--message, --notify and --impact need --status-page'],
    [['--title', 'x', '--message', 'Investigating'], '--message, --notify and --impact need --status-page'],
    [['--title', 'x', '--impact', 'major'], '--message, --notify and --impact need --status-page'],
    [['--title', 'x', '--commander', 'priya@example.com'], '--commander must be "me" or a user UUID'],
  ])('rejects bad flags before calling the API: %j', async (args, message) => {
    await expect(run(...args)).rejects.toThrow(message)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('fails on an unknown or ambiguous service name', async () => {
    mockGet.mockResolvedValueOnce({ data: { services: [] } })
    await expect(run('--title', 'x', '--service', 'Nope')).rejects.toThrow('No service named "Nope"')
    mockGet.mockResolvedValueOnce({ data: { services: [{ id: id(4), name: 'API' }, { id: id(5), name: 'api' }] } })
    await expect(run('--title', 'x', '--service', 'API')).rejects.toThrow('More than one service')
    // A cut list could hide another service with the same name.
    mockGet.mockResolvedValueOnce({ data: { services: [{ id: id(4), name: 'API' }], truncated: true } })
    await expect(run('--title', 'x', '--service', 'API')).rejects.toThrow('Pass the service UUID')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('surfaces API errors (403, 429) as failures', async () => {
    const denied = new ApiRequestError('Insufficient permissions to create incidents', 403, { error: 'Insufficient permissions to create incidents' })
    mockPost.mockRejectedValueOnce(denied)
    await expect(run('--title', 'x')).rejects.toBe(denied)
    const limited = new ApiRequestError('Too many incidents declared. Try again shortly.', 429, { error: 'Too many incidents declared. Try again shortly.' })
    mockPost.mockRejectedValueOnce(limited)
    await expect(run('--title', 'x')).rejects.toBe(limited)
  })
  it('fetches the service list once for several service names (I7)', async () => {
    mockGet.mockResolvedValueOnce({ data: { services: [{ id: id(4), name: 'Checkout' }, { id: id(5), name: 'Search' }, { id: id(6), name: 'Auth' }] } })
    mockPost.mockResolvedValueOnce({ data: { success: true, incident: { id: id(9), incidentNumber: 1 } } })
    await run('--title', 'x', '--service', 'Checkout', '--affected-service', 'Search', '--affected-service', 'Auth')
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(mockPost.mock.calls[0]![1]).toMatchObject({ primaryServiceId: id(4), affected: { serviceIds: [id(5), id(6)] } })
  })
})

describe('incident resources and postmortem', () => {
  const runSub = (...args: string[]) => incidentCommand.parseAsync(['node', 'incident', ...args])
  beforeEach(() => {
    jest.resetAllMocks()
    mockFormat.mockReturnValue('json')
    for (const name of ['resources', 'postmortem']) {
      const command = incidentCommand.commands.find((c) => c.name() === name)!
      for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
    }
  })

  it('lists resources when no change flag is given', async () => {
    mockGet.mockResolvedValueOnce({ data: { success: true, resources: [{ type: 'service', id: id(4), name: 'API' }] } })
    await runSub('resources', id(9))
    expect(mockGet).toHaveBeenCalledWith(`/api/sre/incidents/${id(9)}/resources`)
    expect(mockOutput).toHaveBeenCalledWith([{ type: 'service', id: id(4), name: 'API' }], expect.anything())
  })

  it('patches add and remove, resolving services by name', async () => {
    mockGet.mockResolvedValueOnce({ data: { services: [{ id: id(4), name: 'Checkout' }] } })
    mockPatch.mockResolvedValueOnce({ data: { success: true, added: 2, removed: 1 } })
    await runSub('resources', id(9), '--add-service', 'checkout', '--add-monitor', id(6), '--remove-monitor', id(7))
    expect(mockPatch).toHaveBeenCalledWith(`/api/sre/incidents/${id(9)}/resources`, {
      add: { serviceIds: [id(4)], monitorIds: [id(6)] }, remove: { serviceIds: [], monitorIds: [id(7)] },
    })
    expect(mockOutputDetail).toHaveBeenCalledWith({ added: 2, removed: 1 })
    await expect(runSub('resources', id(9), '--add-monitor', 'nope')).rejects.toThrow('is not a UUID')
  })

  it('prints the post-mortem body in JSON mode', async () => {
    const body = { success: true, postmortem: { sections: { summary: 'x' } }, markdown: '# PM' }
    mockGet.mockResolvedValueOnce({ data: body })
    await runSub('postmortem', id(9))
    expect(mockGet).toHaveBeenCalledWith(`/api/sre/incidents/${id(9)}/postmortem`)
    expect(mockOutputDetail).toHaveBeenCalledWith(body)
  })

  it('prints the markdown without terminal escapes in table mode', async () => {
    mockFormat.mockReturnValue('table')
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    mockGet.mockResolvedValueOnce({ data: { success: true, postmortem: {}, markdown: '# PM\n\u001b]8;;https://evil\u0007click\u001b[0m\tok' } })
    await runSub('postmortem', id(9))
    expect(write).toHaveBeenCalledWith('# PM\n]8;;https://evilclick[0m\tok\n')
    write.mockRestore()
    mockFormat.mockReturnValue('json')
  })
})
