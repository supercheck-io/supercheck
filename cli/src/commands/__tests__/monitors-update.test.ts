import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPatch = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: jest.fn(), patch: mockPatch }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: jest.fn(),
  outputDetail: jest.fn(),
  outputMutation: jest.fn(),
  outputPagination: jest.fn(),
  getOutputFormat: () => 'json',
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}))

const { buildCheckConfigPatch, monitorCommand, replacementPatch } = await import('../monitors.js')

const ID = '019a0000-0000-7000-8000-0000000000a1'
const update = (...args: string[]) => monitorCommand.parseAsync(['node', 'monitor', 'update', ID, ...args])
const aiMonitor = { type: 'http_request', config: { aiEndpoint: { model: 'gpt-4o-mini', secretKey: 'OPENAI_KEY' } } }
const mcpMonitor = { type: 'mcp_server', config: { mcp: { auth: { type: 'bearer', secretKey: 'MCP_TOKEN' }, toolCall: { name: 'search', arguments: { q: 'old', page: 1 } } } } }

describe('monitor update: AI endpoint and MCP options', () => {
  beforeEach(() => { mockGet.mockReset(); mockPatch.mockReset() })

  it('patches only the given AI endpoint fields', async () => {
    mockGet.mockResolvedValueOnce({ data: aiMonitor })
    mockPatch.mockResolvedValueOnce({ data: { id: ID } })
    await update('--model', 'gpt-4.1-mini', '--max-tokens', '64', '--warn-tokens', '500', '--expect', 'pong')
    expect(mockPatch).toHaveBeenCalledWith(`/api/monitors/${ID}`, {
      config: { aiEndpoint: { model: 'gpt-4.1-mini', maxTokens: 64, warnTotalTokens: 500, expectText: 'pong' } },
    })
  })

  it('patches MCP auth, required tools and the tool call, replacing old call arguments', async () => {
    mockGet.mockResolvedValueOnce({ data: mcpMonitor })
    mockPatch.mockResolvedValueOnce({ data: { id: ID } })
    await update('--secret', 'NEW_TOKEN', '--header', 'X-Api-Key', '--require-tool', 'search', '--call-args', '{"q":"ping"}', '--slow-ms', '2500', '--protocol', '2026')
    expect(mockPatch).toHaveBeenCalledWith(`/api/monitors/${ID}`, {
      config: { mcp: {
        auth: { type: 'header', secretKey: 'NEW_TOKEN', headerName: 'X-Api-Key' },
        protocol: '2026',
        requiredTools: ['search'],
        slowMs: 2500,
        toolCall: { arguments: { q: 'ping', page: null } },
      } },
    })
  })

  it('keeps the auth style when only --secret changes, and switches to a header with --header', () => {
    const headerMonitor = { type: 'mcp_server', config: { mcp: { auth: { type: 'header', secretKey: 'OLD', headerName: 'X-Api-Key' } } } }
    expect(buildCheckConfigPatch({ secret: 'T' }, headerMonitor)).toEqual({ mcp: { auth: { type: 'header', secretKey: 'T' } } })
    expect(buildCheckConfigPatch({ secret: 'T' }, mcpMonitor)).toEqual({ mcp: { auth: { type: 'bearer', secretKey: 'T' } } })
    expect(buildCheckConfigPatch({ header: 'X-Key' }, mcpMonitor)).toEqual({ mcp: { auth: { type: 'header', headerName: 'X-Key' } } })
    expect(() => buildCheckConfigPatch({ header: 'X-Key' }, { type: 'mcp_server', config: { mcp: { auth: { type: 'none' } } } })).toThrow('--header requires --secret')
  })

  it('clears the old arguments and expected text when the tool changes, and keeps them for the same tool', () => {
    expect(buildCheckConfigPatch({ callTool: 'other', expect: 'ok' }, mcpMonitor)).toEqual({ mcp: { toolCall: { name: 'other', arguments: null, expectText: 'ok' } } })
    expect(buildCheckConfigPatch({ callTool: 'search' }, mcpMonitor)).toEqual({ mcp: { toolCall: { name: 'search' } } })
    expect(() => buildCheckConfigPatch({ expect: 'x' }, { type: 'mcp_server', config: { mcp: {} } })).toThrow('--call-args and --expect require --call-tool')
  })

  it('replaces nested call arguments exactly and refuses null values', () => {
    expect(replacementPatch({ filter: { status: 'open', team: 'a' }, page: 1 }, { filter: { team: 'x' }, tags: ['a'] }))
      .toEqual({ page: null, filter: { status: null, team: 'x' }, tags: ['a'] })
    expect(replacementPatch({ filter: { status: 'open' } }, { filter: 'all' })).toEqual({ filter: 'all' })
    expect(replacementPatch({ toString: 'old', q: 'old' }, { q: 'new' })).toEqual({ toString: null, q: 'new' })
    expect(() => buildCheckConfigPatch({ callArgs: '{"cursor":null}' }, mcpMonitor)).toThrow('cannot contain null')
    expect(() => buildCheckConfigPatch({ callArgs: '{"a":{"b":null}}' }, mcpMonitor)).toThrow('cannot contain null')
    for (const args of ['{"constructor":1}', '{"a":{"__proto__":{"x":1}}}', '{"a":{"b":{"prototype":1}}}', '{"items":[{"__proto__":{}}]}', '{"a":[[{"constructor":1}]]}']) {
      expect(() => buildCheckConfigPatch({ callArgs: args }, mcpMonitor)).toThrow('__proto__, constructor or prototype')
    }
  })

  it('refuses options that do not fit the monitor, before any write', async () => {
    expect(() => buildCheckConfigPatch({ model: 'm' }, mcpMonitor)).toThrow('--model applies only to AI endpoint monitors')
    expect(() => buildCheckConfigPatch({ callTool: 'x' }, aiMonitor)).toThrow('--call-tool applies only to MCP server monitors')
    expect(() => buildCheckConfigPatch({ model: 'm' }, { type: 'website', config: {} })).toThrow('--model applies only to AI endpoint and MCP server monitors')
    expect(() => buildCheckConfigPatch({ protocol: 'tcp' }, mcpMonitor)).toThrow('--protocol must be auto, 2025 or 2026')
    expect(() => buildCheckConfigPatch({ callArgs: '[1]' }, mcpMonitor)).toThrow('--call-args must be a JSON object')
    expect(() => buildCheckConfigPatch({ maxTokens: '9999' }, aiMonitor)).toThrow()
    expect(() => buildCheckConfigPatch({ model: '  ' }, aiMonitor)).toThrow('--model cannot be empty')
    mockGet.mockResolvedValueOnce({ data: { type: 'website', config: {} } })
    await expect(update('--model', 'm')).rejects.toThrow('applies only to AI endpoint and MCP server monitors')
    expect(mockPatch).not.toHaveBeenCalled()
  })

  it('does not fetch the monitor when no check option is given', async () => {
    mockPatch.mockResolvedValueOnce({ data: { id: ID } })
    await update('--name', 'Renamed')
    expect(mockGet).not.toHaveBeenCalled()
    expect(mockPatch).toHaveBeenCalledWith(`/api/monitors/${ID}`, { name: 'Renamed' })
  })
})
