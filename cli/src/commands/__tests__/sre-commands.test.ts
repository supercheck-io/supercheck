import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockNarrative = jest.fn<(...args: unknown[]) => void>()
let outputFormat = 'table'
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockInfo = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()
const mockError = jest.fn<(...args: unknown[]) => void>()
const mockPostSse = jest.fn<(...args: unknown[]) => Promise<void>>()
const mockRequest = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockGetSse = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({
    get: mockGet,
    post: mockPost,
    patch: mockPatch,
    request: mockRequest,
    getBaseUrl: () => 'https://app.example.com',
  }),
}))

jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  outputMutation: mockOutputDetail,
  outputNarrative: mockNarrative,
  outputPagination: jest.fn(),
  getOutputFormat: () => outputFormat,
}))

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    output: mockOutput,
    info: mockInfo,
    success: mockSuccess,
    error: mockError,
    warn: mockWarn,
    newline: jest.fn(),
    header: jest.fn(),
  },
}))

jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

jest.unstable_mockModule('../../utils/sse.js', () => ({
  postSse: mockPostSse,
  getSse: mockGetSse,
}))

const { incidentCommand } = await import('../incidents.js')
const { serviceCommand } = await import('../services.js')
const { sreCommand } = await import('../sre.js')
const { monitorCommand } = await import('../monitors.js')
const { runCommand } = await import('../runs.js')
const { testCommand } = await import('../tests.js')
const { setRevealSecrets } = await import('../../utils/redact.js')

describe('AI SRE CLI Commands', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    outputFormat = 'table'
    const create = monitorCommand.commands.find((command) => command.name() === 'create')!
    for (const option of create.options) create.setOptionValue(option.attributeName(), option.defaultValue)
  })

  describe('incident commands', () => {
    it('incident list fetches and displays incidents', async () => {
      const mockIncidents = [
        {
          incidentNumber: 1,
          severity: 'sev3',
          status: 'investigating',
          title: 'Test Latency',
          primaryServiceName: 'checkout-api',
          updatedAt: '2026-09-13',
        },
      ]
      mockGet.mockResolvedValueOnce({ data: { incidents: mockIncidents } })

      await incidentCommand.parseAsync(['node', 'incident', 'list', '--status', 'investigating'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents', expect.objectContaining({ status: 'investigating' }))
      // Older servers send no statusLabel; the CLI falls back to the stored status.
      expect(mockOutput).toHaveBeenCalledWith(mockIncidents.map((incident) => ({ ...incident, statusLabel: incident.status })), expect.any(Object))
    })

    it('incident list warns on stderr when the server truncated the list', async () => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [], truncated: true } })
      await incidentCommand.parseAsync(['node', 'incident', 'list'])
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('only the most recent'))
    })

    it('incident get fetches details by id', async () => {
      const mockIncident = { id: '018f0000-0000-7000-8000-000000000001', title: 'Test Incident' }
      mockGet.mockResolvedValueOnce({ data: { incident: mockIncident } })

      await incidentCommand.parseAsync(['node', 'incident', 'get', '018f0000-0000-7000-8000-000000000001'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents/018f0000-0000-7000-8000-000000000001')
      expect(mockOutputDetail).toHaveBeenCalledWith(mockIncident)
    })

    it('incident timeline fetches event timeline', async () => {
      const mockEvents = [{ eventType: 'triage', createdAt: '2026-09-13' }]
      mockGet.mockResolvedValueOnce({ data: { events: mockEvents } })

      await incidentCommand.parseAsync(['node', 'incident', 'timeline', '018f0000-0000-7000-8000-000000000001'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents/018f0000-0000-7000-8000-000000000001/timeline')
      expect(mockOutput).toHaveBeenCalledWith(mockEvents, expect.any(Object))
    })

    it('incident resolve sends resolution comment with --force', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, message: 'Resolved' } })

      await incidentCommand.parseAsync(['node', 'incident', 'resolve', '018f0000-0000-7000-8000-000000000001', '--comment', 'Fix applied', '--force'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/incidents/018f0000-0000-7000-8000-000000000001/resolve', { resolutionSummary: 'Fix applied', comment: 'Fix applied' }, { retries: 0 })
      expect(mockSuccess).toHaveBeenCalledWith('Incident resolved')
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    })
  })

  describe('incident lifecycle commands', () => {
    const id = '018f0000-0000-7000-8000-000000000001'
    const userId = '018f0000-0000-7000-8000-0000000000aa'
    const assignPath = `/api/sre/incidents/${id}/assign`

    it('list passes --assignee through to the API', async () => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [] } })
      await incidentCommand.parseAsync(['node', 'incident', 'list', '--assignee', 'unassigned'])
      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents', expect.objectContaining({ assignee: 'unassigned' }))
    })

    it('resolve accepts --summary', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', 'resolve', id, '--summary', 'Rolled back', '--force'])
      expect(mockPost).toHaveBeenCalledWith(`/api/sre/incidents/${id}/resolve`, { resolutionSummary: 'Rolled back', comment: 'Rolled back' }, { retries: 0 })
    })

    it('resolve requires a summary', async () => {
      await expect(incidentCommand.parseAsync(['node', 'incident', 'resolve', id, '--force'])).rejects.toMatchObject({ exitCode: 3 })
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('assign posts the user and role', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, message: 'Incident #1 assigned' } })
      await incidentCommand.parseAsync(['node', 'incident', 'assign', id, '--user', userId, '--commander'])
      expect(mockPost).toHaveBeenCalledWith(assignPath, { assigneeUserId: userId, role: 'commander' }, { retries: 0 })
      expect(mockSuccess).toHaveBeenCalledWith('Incident #1 assigned')
    })

    it('assign --user me resolves the token owner from /api/context', async () => {
      mockGet.mockResolvedValueOnce({ data: { user: { id: userId } } })
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', 'assign', id, '--user', 'me'])
      expect(mockGet).toHaveBeenCalledWith('/api/context')
      expect(mockPost).toHaveBeenCalledWith(assignPath, { assigneeUserId: userId, role: 'assignee' }, { retries: 0 })
    })

    it('assign rejects a malformed user', async () => {
      await expect(incidentCommand.parseAsync(['node', 'incident', 'assign', id, '--user', 'bob'])).rejects.toMatchObject({ exitCode: 3 })
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('unassign posts a null assignee', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', 'unassign', id])
      expect(mockPost).toHaveBeenCalledWith(assignPath, { assigneeUserId: null, role: 'assignee' }, { retries: 0 })
    })

    it('unassign --commander clears the commander role', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', 'unassign', id, '--commander'])
      expect(mockPost).toHaveBeenCalledWith(assignPath, { assigneeUserId: null, role: 'commander' }, { retries: 0 })
    })

    it('assign --user me fails when the context has no user id', async () => {
      mockGet.mockResolvedValueOnce({ data: {} })
      await expect(incidentCommand.parseAsync(['node', 'incident', 'assign', id, '--user', 'me'])).rejects.toThrow('Could not resolve the current user')
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('maps a bare 404 from assign/ack to a newer-server message but keeps real not-found errors', async () => {
      const { ApiRequestError } = await import('../../utils/errors.js')
      mockPost.mockRejectedValueOnce(new ApiRequestError('Not Found', 404, '<html>404</html>'))
      await expect(incidentCommand.parseAsync(['node', 'incident', 'ack', id])).rejects.toThrow('requires a newer Supercheck server')
      mockPost.mockRejectedValueOnce(new ApiRequestError('Not Found', 404, undefined))
      await expect(incidentCommand.parseAsync(['node', 'incident', 'unassign', id])).rejects.toThrow('requires a newer Supercheck server')
      const notFound = new ApiRequestError('Incident not found', 404, { error: 'Incident not found' })
      mockPost.mockRejectedValueOnce(notFound)
      await expect(incidentCommand.parseAsync(['node', 'incident', 'ack', id])).rejects.toBe(notFound)
    })

    it('ack acknowledges and reports repeats', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, alreadyAcknowledged: false } })
      await incidentCommand.parseAsync(['node', 'incident', 'ack', id])
      expect(mockPost).toHaveBeenCalledWith(`/api/sre/incidents/${id}/acknowledge`, {}, { retries: 0 })
      expect(mockSuccess).toHaveBeenCalledWith('Incident acknowledged')
      mockPost.mockResolvedValueOnce({ data: { success: true, alreadyAcknowledged: true, message: 'Incident #1 was already acknowledged' } })
      await incidentCommand.parseAsync(['node', 'incident', 'ack', id])
      expect(mockInfo).toHaveBeenCalledWith('Incident #1 was already acknowledged')
    })
  })

  describe('incident resolve safeguards', () => {
    const id = '018f0000-0000-7000-8000-000000000001'

    it('reports an already-resolved incident instead of claiming success', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, alreadyResolved: true, message: 'Incident #1 was already resolved' } })
      await incidentCommand.parseAsync(['node', 'incident', 'resolve', id, '--comment', 'x', '--force'])
      expect(mockSuccess).not.toHaveBeenCalled()
      expect(mockInfo).toHaveBeenCalledWith('Incident #1 was already resolved')
    })

    it('refuses to resolve non-interactively without --force', async () => {
      const original = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
      Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
      try {
        await expect(incidentCommand.parseAsync(['node', 'incident', 'resolve', id, '--comment', 'x']))
          .rejects.toMatchObject({ exitCode: 3 })
        expect(mockPost).not.toHaveBeenCalled()
      } finally {
        if (original) Object.defineProperty(process.stdin, 'isTTY', original)
        else delete (process.stdin as { isTTY?: boolean }).isTTY
      }
    })
  })

  describe('sre input validation', () => {
    it.each(['abc', '0', '5'])('rejects invalid --idle-timeout %s', async (value) => {
      await expect(sreCommand.parseAsync(['node', 'sre', 'ask', 'q', '--idle-timeout', value]))
        .rejects.toMatchObject({ exitCode: 3 })
      expect(mockPostSse).not.toHaveBeenCalled()
    })

    it('rejects incident numbers beyond the 32-bit server range', async () => {
      await expect(sreCommand.parseAsync(['node', 'sre', 'triage', '2147483648']))
        .rejects.toMatchObject({ exitCode: 3 })
      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  describe('service commands', () => {
    it('service list fetches services', async () => {
      const mockServices = [{ id: 'svc-1', name: 'checkout-api' }]
      mockGet.mockResolvedValueOnce({ data: { services: mockServices } })

      await serviceCommand.parseAsync(['node', 'service', 'list'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/services')
      expect(mockOutput).toHaveBeenCalledWith(mockServices, expect.any(Object))
    })

    it('service list warns when the server truncated the list', async () => {
      mockGet.mockResolvedValueOnce({ data: { services: [], truncated: true } })
      await serviceCommand.parseAsync(['node', 'service', 'list'])
      expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('first services'))
    })

    it('service get fetches service details', async () => {
      const mockService = { service: { id: 'svc-1', name: 'checkout-api' } }
      mockGet.mockResolvedValueOnce({ data: mockService })

      await serviceCommand.parseAsync(['node', 'service', 'get', 'svc-1'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/services/svc-1')
      expect(mockOutputDetail).toHaveBeenCalledWith(mockService)
    })

    it('service health fetches health snapshot', async () => {
      mockGet.mockResolvedValueOnce({ data: { health: { status: 'healthy', score: 0.99 } } })

      await serviceCommand.parseAsync(['node', 'service', 'health', 'svc-1'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/services/svc-1')
      expect(mockOutputDetail).toHaveBeenCalledWith({ status: 'healthy', score: 0.99 })
    })

    it('service dependencies fetches upstream/downstream graph', async () => {
      const mockDeps = [
        { id: 'dep-1', sourceServiceId: 'svc-1', targetServiceId: 'payment-api' },
        { id: 'dep-2', sourceServiceId: 'frontend-api', targetServiceId: 'svc-1' },
      ]
      mockGet.mockResolvedValueOnce({ data: { dependencies: mockDeps } })

      await serviceCommand.parseAsync(['node', 'service', 'dependencies', 'svc-1'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/services/svc-1')
      expect(mockOutput).toHaveBeenCalledWith(mockDeps, expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ header: 'Direction' }),
          expect.objectContaining({ header: 'Related Service ID' }),
          expect.objectContaining({ header: 'Status' }),
        ]),
      }))

      const options = mockOutput.mock.calls[0]?.[1] as {
        columns: Array<{
          header: string
          format?: (value: unknown, row: Record<string, unknown>) => unknown
        }>
      }
      const directionColumn = options.columns.find(({ header }) => header === 'Direction')
      const relatedServiceColumn = options.columns.find(({ header }) => header === 'Related Service ID')

      expect(directionColumn?.format?.(undefined, mockDeps[0])).toBe('upstream (depends on)')
      expect(directionColumn?.format?.(undefined, mockDeps[1])).toBe('downstream (depended on by)')
      expect(relatedServiceColumn?.format?.(undefined, mockDeps[0])).toBe('payment-api')
      expect(relatedServiceColumn?.format?.(undefined, mockDeps[1])).toBe('frontend-api')
    })
  })

  describe('sre commands', () => {
    const incidentId = '018f0000-0000-7000-8000-000000000001'

    it.each(['triage', 'investigate', 'brief'])('resolves the displayed incident number for sre %s', async (command) => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 1 }] } })
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      mockPostSse.mockResolvedValueOnce(undefined)
      await sreCommand.parseAsync(['node', 'sre', command, '1'])
      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents', { incidentNumber: '1' })
      if (command === 'brief') {
        expect(mockPostSse).toHaveBeenCalledWith('/api/sre/evidence-brief/stream', { incidentId }, expect.any(Function), expect.objectContaining({ idleTimeoutMs: 60_000 }))
      } else {
        expect(mockPost).toHaveBeenCalledWith(`/api/sre/${command}`, expect.objectContaining({ incidentId }), expect.objectContaining({ retries: 0 }))
      }
    })

    it('resolves the incident number for Copilot', async () => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 1 }] } })
      await sreCommand.parseAsync(['node', 'sre', 'ask', 'What failed?', '--incident', '1'])
      expect(mockPostSse).toHaveBeenCalledWith('/api/sre/chat', expect.objectContaining({ incidentId }), expect.any(Function), expect.objectContaining({ idleTimeoutMs: 60_000 }))
    })

    it.each(['get', 'timeline', 'resolve'])('resolves the displayed incident number for incident %s', async (command) => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 1 }] } })
      mockGet.mockResolvedValueOnce({ data: { incident: { id: incidentId }, events: [] } })
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', command, '1', ...(command === 'resolve' ? ['--comment', 'Fixed', '--force'] : [])])
      if (command === 'resolve') {
        expect(mockPost).toHaveBeenCalledWith(`/api/sre/incidents/${incidentId}/resolve`, { resolutionSummary: 'Fixed', comment: 'Fixed' }, { retries: 0 })
      } else {
        expect(mockGet).toHaveBeenCalledWith(`/api/sre/incidents/${incidentId}${command === 'timeline' ? '/timeline' : ''}`)
      }
    })

    it('fails before mutation when an incident number is not found', async () => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 2 }] } })
      await expect(sreCommand.parseAsync(['node', 'sre', 'triage', '1'])).rejects.toThrow('not found in this project')
      expect(mockPost).not.toHaveBeenCalled()
    })

    it.each(['bad-id', '0', '-1', '9007199254740992', '../other'])('rejects invalid incident reference %s', async (reference) => {
      await expect(sreCommand.parseAsync(['node', 'sre', 'triage', '--', reference])).rejects.toThrow('incident number or UUID')
      expect(mockGet).not.toHaveBeenCalled()
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('sre triage runs triage on an incident', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, summary: 'Triage complete' } })

      await sreCommand.parseAsync(['node', 'sre', 'triage', '018f0000-0000-7000-8000-000000000001'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/triage', { incidentId: '018f0000-0000-7000-8000-000000000001' }, { timeout: 90_000, retries: 0 })
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
      expect(mockNarrative).toHaveBeenCalledWith('Triage summary', 'Triage complete')
    })

    it('sre investigate triggers investigation with live-connectors flag', async () => {
      mockPost.mockResolvedValueOnce({ data: { accepted: true, investigationRunId: 'run-1' } })

      await sreCommand.parseAsync(['node', 'sre', 'investigate', '018f0000-0000-7000-8000-000000000001', '--live-connectors'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/investigate', {
        incidentId: '018f0000-0000-7000-8000-000000000001',
        useLiveConnectors: true,
      }, { retries: 0 })
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1', status: 'accepted' }))
    })

    it('preserves the investigation JSON envelope', async () => {
      outputFormat = 'json'
      const data = { success: true, accepted: true, investigationRunId: 'run-1' }
      mockPost.mockResolvedValueOnce({ data })
      await sreCommand.parseAsync(['node', 'sre', 'investigate', '018f0000-0000-7000-8000-000000000001'])
      expect(mockOutputDetail).toHaveBeenCalledWith(data)
      expect(mockInfo).not.toHaveBeenCalled()
    })

    it('does not print stream content in quiet mode', async () => {
      outputFormat = 'quiet'
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      try {
        mockNarrative.mockImplementation(() => undefined)
        mockPostSse.mockImplementationOnce(async (_path, _body, callback) => {
          (callback as (event: { event: string; data: unknown }) => void)({ event: 'message', data: { role: 'assistant', content: 'answer' } })
        })
        await sreCommand.parseAsync(['node', 'sre', 'ask', 'health?'])
        mockPostSse.mockImplementationOnce(async (_path, _body, callback) => {
          (callback as (event: { event: string; data: unknown }) => void)({ event: 'message', data: { type: 'content', content: 'report' } })
        })
        await sreCommand.parseAsync(['node', 'sre', 'brief', '018f0000-0000-7000-8000-000000000001'])
        expect(write).not.toHaveBeenCalled()
        expect(mockOutput).not.toHaveBeenCalled()
      } finally { write.mockRestore() }
    })

    it('sre ask delegates to postSse with chat endpoint', async () => {
      mockPostSse.mockResolvedValueOnce(undefined)

      await sreCommand.parseAsync(['node', 'sre', 'ask', 'What failed?', '--incident', '018f0000-0000-7000-8000-000000000001', '--live-connectors'])

      expect(mockPostSse).toHaveBeenCalledWith(
        '/api/sre/chat',
        {
          message: 'What failed?',
          incidentId: '018f0000-0000-7000-8000-000000000001',
          useLiveConnectorTools: true,
        },
        expect.any(Function),
        expect.objectContaining({ idleTimeoutMs: 60_000 }),
      )
    })

    it('sre brief delegates to postSse with stream endpoint', async () => {
      mockPostSse.mockResolvedValueOnce(undefined)

      await sreCommand.parseAsync(['node', 'sre', 'brief', '018f0000-0000-7000-8000-000000000001'])

      expect(mockPostSse).toHaveBeenCalledWith(
        '/api/sre/evidence-brief/stream',
        { incidentId: '018f0000-0000-7000-8000-000000000001' },
        expect.any(Function),
        expect.objectContaining({ idleTimeoutMs: 60_000 }),
      )
    })
  })

  describe('monitor creation contracts', () => {
    it.each(['http_request', 'website', 'ping_host'])('creates %s monitors with a target and minute interval', async (type) => {
      mockPost.mockResolvedValueOnce({ data: { id: 'monitor-1' } })
      const target = type === 'ping_host' ? 'example.com' : 'https://example.com'
      await monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'Demo', '--type', type, '--url', target])
      expect(mockPost).toHaveBeenCalledWith('/api/monitors', expect.objectContaining({ target, type, frequencyMinutes: 5 }))
    })

    it('creates an AI endpoint preset monitor with a secret name, never a key, and no request fields', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'monitor-1' } })
      await monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'LLM', '--url', 'https://api.openai.com/v1/chat/completions', '--preset', 'ai-endpoint', '--model', 'gpt-4o-mini', '--secret', 'OPENAI_KEY', '--expect', 'ok'])
      expect(mockPost).toHaveBeenCalledWith('/api/monitors', expect.objectContaining({
        type: 'http_request',
        config: { timeoutSeconds: 60, aiEndpoint: { model: 'gpt-4o-mini', secretKey: 'OPENAI_KEY', expectText: 'ok' } },
      }))
    })

    it('passes max tokens and the first-token limit for the preset', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'monitor-1' } })
      await monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'LLM', '--url', 'https://api.openai.com/v1/chat/completions', '--preset', 'ai-endpoint', '--model', 'gpt-5', '--max-tokens', '256', '--first-token-timeout', '20000'])
      expect(mockPost).toHaveBeenCalledWith('/api/monitors', expect.objectContaining({
        config: { timeoutSeconds: 60, aiEndpoint: { model: 'gpt-5', maxTokens: 256, firstTokenTimeoutMs: 20000 } },
      }))
    })

    it.each([
      [['--preset', 'ai-endpoint'], /--model is required/],
      [['--preset', 'nope', '--model', 'm'], /Unknown preset/],
      [['--model', 'm'], /--model requires --preset ai-endpoint/],
      [['--type', 'website', '--preset', 'ai-endpoint', '--model', 'm'], /requires --type http_request/],
      [['--preset', 'ai-endpoint', '--model', 'm', '--method', 'GET'], /--method cannot be used/],
      [['--max-tokens', '64'], /--max-tokens requires --preset/],
      [['--preset', 'ai-endpoint', '--model', 'm', '--max-tokens', '0'], /--max-tokens/],
    ])('rejects an invalid preset invocation %j', async (args, message) => {
      await expect(monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'LLM', '--url', 'https://api.example.com/v1/chat/completions', ...args])).rejects.toMatchObject({ exitCode: 3, message: expect.stringMatching(message) })
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('creates port checks with the required numeric port and protocol', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'monitor-1' } })
      await monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'Port', '--type', 'port_check', '--url', 'example.com', '--port', '443'])
      expect(mockPost).toHaveBeenCalledWith('/api/monitors', expect.objectContaining({ config: expect.objectContaining({ port: 443, protocol: 'tcp' }) }))
    })

    it('creates synthetic checks with a test UUID and no URL', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'monitor-1' } })
      const testId = '018f0000-0000-7000-8000-000000000001'
      await monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'Synthetic', '--type', 'synthetic_test', '--test-id', testId])
      expect(mockPost).toHaveBeenCalledWith('/api/monitors', expect.objectContaining({ target: '', config: expect.objectContaining({ testId }) }))
    })

    it.each([
      ['--type', 'synthetic_test'],
      ['--type', 'port_check', '--url', 'example.com'],
      ['--url', 'https://example.com', '--timeout', '3601'],
      ['--url', 'https://example.com', '--interval', '86460'],
    ])('rejects missing type-specific fields or values beyond API limits: %s', async (...args) => {
      await expect(monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'Invalid', ...args])).rejects.toMatchObject({ exitCode: 3 })
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('execution stream exit codes', () => {
    const stream = async (_path: unknown, callback: unknown) => {
      (callback as (event: { event: string; data: unknown }) => void)({ event: 'complete', data: { status: 'failed' } })
    }
    it('preserves console transport chunks without adding newlines', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: 'hel' } })
        onEvent({ event: 'console', data: { line: 'lo\n' } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      expect(write.mock.calls.map((call) => call[0]).join('')).toBe('hello\n')
      write.mockRestore()
    })
    it('run stream rejects failed runs instead of printing a success', async () => {
      mockGetSse.mockImplementationOnce(stream)
      await expect(runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])).rejects.toMatchObject({ exitCode: 1 })
      expect(mockSuccess).not.toHaveBeenCalled()
    })
    it('run stream redacts a token split across two console events', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: 'token sck_live_aaaaaa' } })
        onEvent({ event: 'console', data: { line: `${'a'.repeat(30)} done\n` } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).not.toContain('sck_live_')
      expect(out).toContain('done\n')
    })
    it('run stream flushes an unterminated console remainder, redacted, at the terminal event and on errors', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const token = `sck_live_${'b'.repeat(32)}`
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: `tail ${token}` } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        (callback as (event: { event: string; data: unknown }) => void)({ event: 'console', data: { line: 'partial' } })
        throw new Error('boom')
      })
      await expect(runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])).rejects.toThrow('boom')
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).toContain('tail [REDACTED]')
      expect(out).not.toContain(token)
      expect(out).toContain('partial')
    })
    it('run stream redacts a token straddling the overflow boundary of a newline-less stream', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const token = `sck_live_${'c'.repeat(32)}`
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        // The token starts just before the cap, so a cut at the cap would split it.
        onEvent({ event: 'console', data: { line: `${'x'.repeat(64 * 1024 - 10)}${token.slice(0, 20)}` } })
        onEvent({ event: 'console', data: { line: `${token.slice(20)} end` } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      // No whitespace before the token to cut at: the chunk is omitted and so is the token's continuation.
      expect(out).not.toContain('sck_live_')
      expect(out).not.toContain('c'.repeat(12))
      expect(out).toContain('[console output omitted: line too long]')
      expect(out).toContain(' end')
    })
    it('run stream never splits a token at the overflow cut point itself', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const token = `sck_live_${'e'.repeat(32)}`
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        // Words up to just under the cap, then the token positioned to straddle (cap - 1024): the old fixed cut.
        const head = 'word '.repeat(Math.floor((64 * 1024 - 1024 - 6) / 5))
        onEvent({ event: 'console', data: { line: `${head}${token}` } })
        // Exceeds the cap by one, so the old fixed cut (length - 1024) lands inside the token.
        onEvent({ event: 'console', data: { line: ' '.repeat(991) } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).not.toContain('sck_live_')
      expect(out).not.toContain('e'.repeat(32))
      expect(out).toContain('[REDACTED]')
    })
    it('run stream flushes a token still buffered without a newline when the stream completes', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const token = `sck_live_${'g'.repeat(32)}`
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: `done ${token.slice(0, 15)}` } })
        onEvent({ event: 'console', data: { line: token.slice(15) } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).toContain('done [REDACTED]')
      expect(out).not.toContain('g'.repeat(10))
    })
    it('run stream omits an overflowing chunk with no whitespace to cut at', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: `sck_live_${'f'.repeat(64 * 1024)}` } })
        onEvent({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).toContain('[console output omitted: line too long]')
      expect(out).not.toContain('f'.repeat(100))
    })
    it('run stream redacts a token still in the remainder when the stream ends', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        const onEvent = callback as (event: { event: string; data: unknown }) => void
        onEvent({ event: 'console', data: { line: `${'y'.repeat(64 * 1024 + 5)}sck_live_${'d'.repeat(32)}` } })
      })
      mockRequest.mockResolvedValueOnce({ data: { status: 'passed' } })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      const out = write.mock.calls.map((call) => call[0]).join('')
      write.mockRestore()
      expect(out).not.toContain('sck_live_')
      expect(out).toContain('[console output omitted: line too long]')
    })
    it('run stream polls past a queued complete event and succeeds when the run passes', async () => {
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        (callback as (event: { event: string; data: unknown }) => void)({ event: 'complete', data: { status: 'queued' } })
      })
      mockRequest.mockResolvedValueOnce({ data: { status: 'passed' } })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      expect(mockRequest).toHaveBeenCalledWith('GET', '/api/runs/run-1', expect.anything())
    })
    it('run stream polls when the stream ends cleanly without a terminal event', async () => {
      mockRequest.mockClear()
      mockGetSse.mockResolvedValueOnce(undefined)
      mockRequest.mockResolvedValueOnce({ data: { status: 'passed' } })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      expect(mockRequest).toHaveBeenCalledTimes(1)
    })
    it('run stream falls back to polling when the stream drops before a terminal event', async () => {
      const { CLIError, ExitCode } = await import('../../utils/errors.js')
      mockGetSse.mockRejectedValueOnce(new CLIError('Stream ended before the server reported completion.', ExitCode.ApiError))
      mockRequest.mockResolvedValueOnce({ data: { status: 'passed' } })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      expect(mockRequest).toHaveBeenCalledWith('GET', '/api/runs/run-1', expect.anything())
    })
    it('run stream does not poll after Ctrl-C', async () => {
      const { CLIError, ExitCode } = await import('../../utils/errors.js')
      mockRequest.mockClear()
      mockGetSse.mockRejectedValueOnce(new CLIError('Cancelled', ExitCode.Interrupted))
      await expect(runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])).rejects.toMatchObject({ exitCode: ExitCode.Interrupted })
      expect(mockRequest).not.toHaveBeenCalled()
    })
    it('run stream fails on an unknown complete status', async () => {
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        (callback as (event: { event: string; data: unknown }) => void)({ event: 'complete', data: { status: 'weird' } })
      })
      await expect(runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])).rejects.toMatchObject({ exitCode: 1 })
    })
    it('run stream redacts CLI tokens in console lines', async () => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const token = `sck_live_${'a'.repeat(32)}`
      mockGetSse.mockImplementationOnce(async (_path: unknown, callback: unknown) => {
        (callback as (event: { event: string; data: unknown }) => void)({ event: 'console', data: { line: `token ${token}\n` } })
        ;(callback as (event: { event: string; data: unknown }) => void)({ event: 'complete', data: { status: 'passed' } })
      })
      await runCommand.parseAsync(['node', 'run', 'stream', 'run-1'])
      expect(write.mock.calls.map((call) => call[0]).join('')).not.toContain(token)
      write.mockRestore()
    })
    it('test status requires a terminal event before the stream may end', async () => {
      mockGetSse.mockResolvedValueOnce(undefined)
      await testCommand.parseAsync(['node', 'test', 'status', 'test-1'])
      const options = mockGetSse.mock.calls.at(-1)?.[2] as { isTerminal: (event: { data: unknown }) => boolean }
      expect(options.isTerminal({ data: { derivedStatus: 'passed' } })).toBe(true)
      expect(options.isTerminal({ data: { status: 'error' } })).toBe(true)
      expect(options.isTerminal({ data: { derivedStatus: 'running' } })).toBe(false)
    })
    it('test status uses derived report status when queue status says completed', async () => {
      mockGetSse.mockImplementationOnce(async (_path, callback) => {
        (callback as (event: { data: unknown }) => void)({ data: { status: 'completed', derivedStatus: 'failed' } })
      })
      await expect(testCommand.parseAsync(['node', 'test', 'status', 'test-1'])).rejects.toMatchObject({ exitCode: 1 })
    })
  })

  it('test get --include-script redacts the script and says so unless --show-secrets is set', async () => {
    mockGet.mockResolvedValue({ data: { id: 't1', script: Buffer.from('const k = "x"').toString('base64') } })
    await testCommand.parseAsync(['node', 'test', 'get', 't1', '--include-script'])
    expect(mockOutput).toHaveBeenCalledWith('const k = "x"\n', { redact: true })
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('--show-secrets'))
    mockOutput.mockClear(); mockWarn.mockClear()
    setRevealSecrets(true)
    try {
      await testCommand.parseAsync(['node', 'test', 'get', 't1', '--include-script'])
    } finally { setRevealSecrets(false) }
    expect(mockOutput).toHaveBeenCalledWith('const k = "x"\n', { redact: false })
    expect(mockWarn).not.toHaveBeenCalled()
    mockGet.mockReset()
  })

  describe('test tag commands', () => {
    const TEST_ID = '019a0000-0000-7000-8000-000000000001'
    const projectTags = [{ id: 'tag-smoke', name: 'Smoke' }, { id: 'tag-web', name: 'web' }]

    it('test tag add patches only the named tags onto the test', async () => {
      mockGet.mockImplementation(async (path) => ({ data: path === '/api/tags' ? projectTags : [{ id: 'tag-web', name: 'web' }] }))
      mockPatch.mockResolvedValueOnce({ data: projectTags })
      await testCommand.parseAsync(['node', 'test', 'tag', 'add', TEST_ID, 'smoke'])
      expect(mockPatch).toHaveBeenCalledWith(`/api/tests/${TEST_ID}/tags`, { add: ['tag-smoke'] })
      expect(mockSuccess).toHaveBeenCalledWith(`Test ${TEST_ID} now has 2 tag(s)`)
      mockGet.mockReset()
    })

    it('test tag remove patches only the named tags off the test', async () => {
      mockGet.mockImplementation(async (path) => ({ data: path === '/api/tags' ? projectTags : projectTags }))
      mockPatch.mockResolvedValueOnce({ data: [projectTags[1]] })
      await testCommand.parseAsync(['node', 'test', 'tag', 'remove', TEST_ID, 'SMOKE'])
      expect(mockPatch).toHaveBeenCalledWith(`/api/tests/${TEST_ID}/tags`, { remove: ['tag-smoke'] })
      mockGet.mockReset()
    })

    it('encodes the test id in the tag path', async () => {
      mockGet.mockImplementation(async (path) => ({ data: path === '/api/tags' ? projectTags : [] }))
      mockPatch.mockResolvedValueOnce({ data: [] })
      await testCommand.parseAsync(['node', 'test', 'tag', 'add', 'a/b', 'smoke'])
      expect(mockPatch).toHaveBeenCalledWith('/api/tests/a%2Fb/tags', { add: ['tag-smoke'] })
      mockGet.mockReset()
    })
  })

  it.each(['create', 'update'])('test %s --file strips pulled @title/@priority/@tags annotations before sending', async (action) => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'supercheck-test-file-'))
    const file = join(dir, 'home.pw.ts')
    writeFileSync(file, "// @title Home\n// @priority high\n// @tags core\nimport { test } from '@playwright/test'\ntest('home', async () => {})\n")
    const send = action === 'create' ? mockPost : mockPatch
    send.mockResolvedValueOnce({ data: {} })
    const args = action === 'create' ? ['create', '--title', 'Home'] : ['update', '019a0000-0000-7000-8000-000000000001']
    try {
      await testCommand.parseAsync(['node', 'test', ...args, '--file', file, '--type', 'browser'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const [, body] = send.mock.calls.at(-1) as [string, { script: string }]
    const script = Buffer.from(body.script, 'base64').toString('utf8')
    expect(script).toContain("test('home'")
    expect(script).not.toMatch(/@title|@priority|@tags/)
  })

  describe('test priority flags', () => {
    it('test list sends a lowercase priority filter and rejects an unknown one', async () => {
      mockGet.mockResolvedValueOnce({ data: { data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 1 } } })
      await testCommand.parseAsync(['node', 'test', 'list', '--priority', 'HIGH'])
      expect(mockGet).toHaveBeenCalledWith('/api/tests', expect.objectContaining({ priority: 'high' }))
      await expect(testCommand.parseAsync(['node', 'test', 'list', '--priority', 'urgent'])).rejects.toThrow('Invalid priority')
    })

    it('test update --priority --dry-run previews the payload without sending it', async () => {
      await testCommand.parseAsync(['node', 'test', 'update', '019a0000-0000-7000-8000-000000000001', '--priority', 'Low', '--dry-run'])
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, payload: expect.objectContaining({ priority: 'low' }) }))
      expect(mockPost).not.toHaveBeenCalled()
    })
  })
})

