import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockNarrative = jest.fn<(...args: unknown[]) => void>()
let outputFormat = 'table'
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockInfo = jest.fn<(...args: unknown[]) => void>()
const mockError = jest.fn<(...args: unknown[]) => void>()
const mockPostSse = jest.fn<(...args: unknown[]) => Promise<void>>()
const mockGetSse = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({
    get: mockGet,
    post: mockPost,
  }),
}))

jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
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
    warn: jest.fn(),
    newline: jest.fn(),
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
      expect(mockOutput).toHaveBeenCalledWith(mockIncidents, expect.any(Object))
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

      expect(mockPost).toHaveBeenCalledWith('/api/sre/incidents/018f0000-0000-7000-8000-000000000001/resolve', { comment: 'Fix applied' })
      expect(mockSuccess).toHaveBeenCalledWith('Incident resolved')
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
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

      expect(directionColumn?.format?.(undefined, mockDeps[0])).toBe('downstream')
      expect(directionColumn?.format?.(undefined, mockDeps[1])).toBe('upstream')
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
        expect(mockPostSse).toHaveBeenCalledWith('/api/sre/evidence-brief/stream', { incidentId }, expect.any(Function), expect.any(Number))
      } else {
        expect(mockPost).toHaveBeenCalledWith(`/api/sre/${command}`, expect.objectContaining({ incidentId }))
      }
    })

    it('resolves the incident number for Copilot', async () => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 1 }] } })
      await sreCommand.parseAsync(['node', 'sre', 'ask', 'What failed?', '--incident', '1'])
      expect(mockPostSse).toHaveBeenCalledWith('/api/sre/chat', expect.objectContaining({ incidentId }), expect.any(Function), expect.any(Number))
    })

    it.each(['get', 'timeline', 'resolve'])('resolves the displayed incident number for incident %s', async (command) => {
      mockGet.mockResolvedValueOnce({ data: { incidents: [{ id: incidentId, incidentNumber: 1 }] } })
      mockGet.mockResolvedValueOnce({ data: { incident: { id: incidentId }, events: [] } })
      mockPost.mockResolvedValueOnce({ data: { success: true } })
      await incidentCommand.parseAsync(['node', 'incident', command, '1', ...(command === 'resolve' ? ['--comment', 'Fixed', '--force'] : [])])
      if (command === 'resolve') {
        expect(mockPost).toHaveBeenCalledWith(`/api/sre/incidents/${incidentId}/resolve`, { comment: 'Fixed' })
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

      expect(mockPost).toHaveBeenCalledWith('/api/sre/triage', { incidentId: '018f0000-0000-7000-8000-000000000001' })
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
      expect(mockNarrative).toHaveBeenCalledWith('Triage summary', 'Triage complete')
    })

    it('sre investigate triggers investigation with live-connectors flag', async () => {
      mockPost.mockResolvedValueOnce({ data: { accepted: true, investigationRunId: 'run-1' } })

      await sreCommand.parseAsync(['node', 'sre', 'investigate', '018f0000-0000-7000-8000-000000000001', '--live-connectors'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/investigate', {
        incidentId: '018f0000-0000-7000-8000-000000000001',
        useLiveConnectors: true,
      })
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
        expect.any(Number),
      )
    })

    it('sre brief delegates to postSse with stream endpoint', async () => {
      mockPostSse.mockResolvedValueOnce(undefined)

      await sreCommand.parseAsync(['node', 'sre', 'brief', '018f0000-0000-7000-8000-000000000001'])

      expect(mockPostSse).toHaveBeenCalledWith(
        '/api/sre/evidence-brief/stream',
        { incidentId: '018f0000-0000-7000-8000-000000000001' },
        expect.any(Function),
        expect.any(Number),
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
    it('test status uses derived report status when queue status says completed', async () => {
      mockGetSse.mockImplementationOnce(async (_path, callback) => {
        (callback as (event: { data: unknown }) => void)({ data: { status: 'completed', derivedStatus: 'failed' } })
      })
      await expect(testCommand.parseAsync(['node', 'test', 'status', 'test-1'])).rejects.toMatchObject({ exitCode: 1 })
    })
  })
})
