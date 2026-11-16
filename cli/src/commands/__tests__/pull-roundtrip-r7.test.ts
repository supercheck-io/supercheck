import { jest, describe, it, expect } from '@jest/globals'

const mockWarn = jest.fn<(...args: unknown[]) => void>()
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: mockWarn, debug: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))

const { buildMonitorDefinitions, buildJobDefinitions } = await import('../pull.js')
const { jobCronWarning } = await import('../../utils/cron.js')

describe('pull round trip', () => {
  it('drops legacy monitor config keys the server now rejects', () => {
    const [def] = buildMonitorDefinitions([{
      id: 'm', name: 'M', type: 'website', target: 'https://example.com',
      config: { timeoutSeconds: 10, responseBodyJsonPath: '$.a', checkExpiration: true, daysUntilExpirationWarning: 7, checkRevocation: false, sslCheckOnStatusChange: true },
    } as never])
    expect(def.config).toEqual({ timeoutSeconds: 10 })
  })

  it('pulls an MCP monitor with config.mcp intact and mcpState dropped', () => {
    const mcp = { auth: { type: 'bearer', secretKey: 'MCP_TOKEN' }, requiredTools: ['search_docs'], slowMs: 3000 }
    const [def] = buildMonitorDefinitions([{
      id: 'm', name: 'MCP', type: 'mcp_server', target: 'https://mcp.example.com/mcp',
      config: { timeoutSeconds: 30, mcp, mcpState: { lastCycleKey: 'c1', baseline: { hash: 'h', tools: [] } } },
    } as never])
    expect(def.config).toEqual({ timeoutSeconds: 30, mcp })
  })

  it('drops aiEndpointState and keeps config.aiEndpoint on an AI endpoint monitor', () => {
    const aiEndpoint = { model: 'gpt-4o-mini', secretKey: 'OPENAI_KEY', warnFirstTokenMs: 2000 }
    const [def] = buildMonitorDefinitions([{
      id: 'm', name: 'AI', type: 'http_request', target: 'https://api.example.com/v1/chat/completions',
      config: { timeoutSeconds: 60, aiEndpoint, aiEndpointState: { lastServedModel: 'gpt-4o-mini-2024-07-18' } },
    } as never])
    expect(def.config).toEqual({ timeoutSeconds: 60, aiEndpoint })
  })

  it('warns when a pulled job cron is not 5 fields', () => {
    mockWarn.mockClear()
    buildJobDefinitions([{ id: 'j', name: 'Every second', cronSchedule: '* * * * * *', tests: [] } as never], new Map())
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('5-field'))
  })

  it('accepts 5-field and empty crons', () => {
    expect(jobCronWarning('J', '*/5 * * * *')).toBeNull()
    expect(jobCronWarning('J', '')).toBeNull()
  })
})
