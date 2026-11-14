import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: jest.fn(), post: mockPost, patch: jest.fn() }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: jest.fn(),
  outputDetail: mockOutputDetail,
  outputMutation: mockOutputDetail,
  outputPagination: jest.fn(),
  getOutputFormat: () => 'json',
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_label: string, fn: () => Promise<unknown>) => fn(),
}))

const { buildMcpConfig, buildAiEndpointPreset } = await import('../monitors.js')
const { monitorCommand } = await import('../monitors.js')

const create = (...args: string[]) =>
  monitorCommand.parseAsync(['node', 'monitor', 'create', '--name', 'Docs MCP', '--type', 'mcp_server', ...args])

describe('monitor create --type mcp_server', () => {
  beforeEach(() => { mockPost.mockReset(); mockOutputDetail.mockReset() })

  it('sends a none-auth config by default', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'm1' } })
    await create('--url', 'https://mcp.example.com/mcp')
    expect(mockPost).toHaveBeenCalledWith('/api/monitors', {
      name: 'Docs MCP', target: 'https://mcp.example.com/mcp', type: 'mcp_server', frequencyMinutes: 5,
      config: { timeoutSeconds: 30, mcp: { auth: { type: 'none' } } },
    })
  })

  it('maps --secret to bearer and --secret with --header to header auth, never a token value', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'm1' } })
    await create('--url', 'https://mcp.example.com/mcp', '--secret', 'MCP_TOKEN')
    expect(mockPost.mock.calls[0][1]).toMatchObject({ config: { mcp: { auth: { type: 'bearer', secretKey: 'MCP_TOKEN' } } } })
    expect(buildMcpConfig({ secret: 'K', header: 'X-Api-Key' }, 'mcp_server')).toEqual({ auth: { type: 'header', secretKey: 'K', headerName: 'X-Api-Key' } })
  })

  it('sends the protocol, required tools, tool call and slow limit and returns the API object as JSON', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'm1', type: 'mcp_server' } })
    await create('--url', 'https://mcp.example.com/mcp', '--protocol', '2026', '--require-tool', 'search_docs', '--require-tool', 'get_page',
      '--call-tool', 'search_docs', '--call-args', '{"q":"ping"}', '--expect', 'result', '--slow-ms', '3000', '--timeout', '20')
    expect(mockPost.mock.calls[0][1]).toMatchObject({
      config: {
        timeoutSeconds: 20,
        mcp: {
          auth: { type: 'none' }, protocol: '2026', requiredTools: ['search_docs', 'get_page'],
          toolCall: { name: 'search_docs', arguments: { q: 'ping' }, expectText: 'result' }, slowMs: 3000,
        },
      },
    })
    expect(mockOutputDetail).toHaveBeenCalledWith({ id: 'm1', type: 'mcp_server' })
  })

  it.each([
    [['--url', 'http://mcp.example.com/mcp'], /https URL/],
    [['--url', 'https://user:pw@mcp.example.com/mcp'], /no credentials/],
    [['--url', 'https://mcp.example.com/mcp', '--header', 'X-Key'], /--header requires --secret/],
    [['--url', 'https://mcp.example.com/mcp', '--protocol', '2024'], /--protocol must be/],
    [['--url', 'https://mcp.example.com/mcp', '--call-args', '{}'], /require --call-tool/],
    [['--url', 'https://mcp.example.com/mcp', '--call-tool', 't', '--call-args', '[1]'], /JSON object/],
    [['--url', 'https://mcp.example.com/mcp', '--slow-ms', '50'], /--slow-ms/],
  ])('rejects %j', async (args, message) => {
    await expect(create(...args)).rejects.toMatchObject({ exitCode: 3, message: expect.stringMatching(message) })
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects MCP flags on other types', () => {
    expect(() => buildMcpConfig({ requireTool: ['x'] }, 'website')).toThrow(/--require-tool requires --type mcp_server/)
    expect(buildMcpConfig({}, 'website')).toBeUndefined()
  })
})

describe('ai-endpoint warning flags', () => {
  it('maps --warn-first-token-ms and --warn-tokens', () => {
    expect(buildAiEndpointPreset({ preset: 'ai-endpoint', model: 'm', warnFirstTokenMs: '2000', warnTokens: '400' }, 'http_request'))
      .toEqual({ model: 'm', warnFirstTokenMs: 2000, warnTotalTokens: 400 })
    expect(() => buildAiEndpointPreset({ warnTokens: '5' }, 'http_request')).toThrow(/--warn-tokens requires --preset/)
  })
})
