import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockInfo = jest.fn<(...args: unknown[]) => void>()
const mockError = jest.fn<(...args: unknown[]) => void>()
const mockPostSse = jest.fn<(...args: unknown[]) => Promise<void>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({
    get: mockGet,
    post: mockPost,
  }),
}))

jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  getOutputFormat: () => 'table',
}))

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    output: mockOutput,
    info: mockInfo,
    success: mockSuccess,
    error: mockError,
    newline: jest.fn(),
  },
}))

jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

jest.unstable_mockModule('../../utils/sse.js', () => ({
  postSse: mockPostSse,
}))

const { incidentCommand } = await import('../incidents.js')
const { serviceCommand } = await import('../services.js')
const { sreCommand } = await import('../sre.js')

describe('AI SRE CLI Commands', () => {
  beforeEach(() => {
    jest.clearAllMocks()
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
      const mockIncident = { id: 'inc-123', title: 'Test Incident' }
      mockGet.mockResolvedValueOnce({ data: { incident: mockIncident } })

      await incidentCommand.parseAsync(['node', 'incident', 'get', 'inc-123'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents/inc-123')
      expect(mockOutputDetail).toHaveBeenCalledWith(mockIncident)
    })

    it('incident timeline fetches event timeline', async () => {
      const mockEvents = [{ eventType: 'triage', createdAt: '2026-09-13' }]
      mockGet.mockResolvedValueOnce({ data: { events: mockEvents } })

      await incidentCommand.parseAsync(['node', 'incident', 'timeline', 'inc-123'])

      expect(mockGet).toHaveBeenCalledWith('/api/sre/incidents/inc-123/timeline')
      expect(mockOutput).toHaveBeenCalledWith(mockEvents, expect.any(Object))
    })

    it('incident resolve sends resolution comment with --force', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, message: 'Resolved' } })

      await incidentCommand.parseAsync(['node', 'incident', 'resolve', 'inc-123', '--comment', 'Fix applied', '--force'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/incidents/inc-123/resolve', { comment: 'Fix applied' })
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
    it('sre triage runs triage on an incident', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, summary: 'Triage complete' } })

      await sreCommand.parseAsync(['node', 'sre', 'triage', 'inc-123'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/triage', { incidentId: 'inc-123' })
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
    })

    it('sre investigate triggers investigation with live-connectors flag', async () => {
      mockPost.mockResolvedValueOnce({ data: { accepted: true, investigationRunId: 'run-1' } })

      await sreCommand.parseAsync(['node', 'sre', 'investigate', 'inc-123', '--live-connectors'])

      expect(mockPost).toHaveBeenCalledWith('/api/sre/investigate', {
        incidentId: 'inc-123',
        useLiveConnectors: true,
      })
      expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ accepted: true }))
    })

    it('sre ask delegates to postSse with chat endpoint', async () => {
      mockPostSse.mockResolvedValueOnce(undefined)

      await sreCommand.parseAsync(['node', 'sre', 'ask', 'What failed?', '--incident', 'inc-123', '--live-connectors'])

      expect(mockPostSse).toHaveBeenCalledWith(
        '/api/sre/chat',
        {
          message: 'What failed?',
          incidentId: 'inc-123',
          useLiveConnectorTools: true,
        },
        expect.any(Function),
        expect.any(Number),
      )
    })

    it('sre brief delegates to postSse with stream endpoint', async () => {
      mockPostSse.mockResolvedValueOnce(undefined)

      await sreCommand.parseAsync(['node', 'sre', 'brief', 'inc-123'])

      expect(mockPostSse).toHaveBeenCalledWith(
        '/api/sre/evidence-brief/stream',
        { incidentId: 'inc-123' },
        expect.any(Function),
        expect.any(Number),
      )
    })
  })
})
