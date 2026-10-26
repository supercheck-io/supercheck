import { jest, describe, it, expect, beforeEach } from '@jest/globals'

type Fn = (...args: unknown[]) => Promise<{ data: unknown }>
const mockGet = jest.fn<Fn>()
const mockPost = jest.fn<Fn>()
const mockPatch = jest.fn<Fn>()
const mockDelete = jest.fn<Fn>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockOutputMutation = jest.fn<(...args: unknown[]) => void>()
const mockConfirmPrompt = jest.fn<(...args: unknown[]) => Promise<boolean>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, post: mockPost, patch: mockPatch, delete: mockDelete }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput, outputDetail: mockOutputDetail, outputMutation: mockOutputMutation,
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: jest.fn(), info: jest.fn(), success: jest.fn(), error: jest.fn(), warn: jest.fn(), newline: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))
jest.unstable_mockModule('../../utils/prompt.js', () => ({ confirmPrompt: mockConfirmPrompt }))

const { analyticsCommand } = await import('../analytics.js')
const { tokenCommand } = await import('../tokens.js')
const { projectCommand } = await import('../projects.js')

function reset(command: import('commander').Command): void {
  for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  for (const child of command.commands) reset(child)
}

describe('analytics, token and project commands', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    for (const c of [analyticsCommand, tokenCommand, projectCommand]) reset(c)
    mockConfirmPrompt.mockResolvedValue(true)
  })

  it('fetches playwright analytics with job and period', async () => {
    mockGet.mockResolvedValueOnce({ data: { runs: 3 } })
    await analyticsCommand.parseAsync(['node', 'analytics', 'playwright', '--job', 'j1', '--period', '60'])
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/playwright', expect.objectContaining({ period: '60', jobId: 'j1' }))
    expect(mockOutputDetail).toHaveBeenCalledWith({ runs: 3 })
  })

  it('fetches k6 analytics for a run comparison', async () => {
    mockGet.mockResolvedValueOnce({ data: {} })
    await analyticsCommand.parseAsync(['node', 'analytics', 'k6', '--left-run', 'a', '--right-run', 'b'])
    expect(mockGet).toHaveBeenCalledWith('/api/analytics/k6', expect.objectContaining({ leftRunId: 'a', rightRunId: 'b', period: '30' }))
  })

  it('lists tokens', async () => {
    mockGet.mockResolvedValueOnce({ data: { tokens: [{ id: 't1' }] } })
    await tokenCommand.parseAsync(['node', 'token', 'list'])
    expect(mockGet).toHaveBeenCalledWith('/api/cli-tokens')
    expect(mockOutput).toHaveBeenCalledWith([{ id: 't1' }], expect.anything())
  })

  it('creates a token with an expiry in seconds', async () => {
    mockPost.mockResolvedValueOnce({ data: { token: { id: 't2', key: 'sck_live_x' } } })
    await tokenCommand.parseAsync(['node', 'token', 'create', 'ci', '--expires-in', '7'])
    expect(mockPost).toHaveBeenCalledWith('/api/cli-tokens', { name: 'ci', expiresIn: 604800 })
    expect(mockOutputMutation).toHaveBeenCalledWith({ id: 't2', key: 'sck_live_x', action: 'created' })
  })

  it('enables and disables a token with PATCH', async () => {
    mockPatch.mockResolvedValue({ data: {} })
    await tokenCommand.parseAsync(['node', 'token', 'disable', 't1'])
    expect(mockPatch).toHaveBeenLastCalledWith('/api/cli-tokens/t1', { enabled: false })
    await tokenCommand.parseAsync(['node', 'token', 'enable', 't1'])
    expect(mockPatch).toHaveBeenLastCalledWith('/api/cli-tokens/t1', { enabled: true })
  })

  it('confirms before revoking and skips the prompt with --force', async () => {
    mockDelete.mockResolvedValue({ data: {} })
    await tokenCommand.parseAsync(['node', 'token', 'revoke', 't1'])
    expect(mockConfirmPrompt).toHaveBeenCalledTimes(1)
    expect(mockDelete).toHaveBeenCalledWith('/api/cli-tokens/t1')
    await tokenCommand.parseAsync(['node', 'token', 'revoke', 't2', '--force'])
    expect(mockConfirmPrompt).toHaveBeenCalledTimes(1)
    expect(mockOutputMutation).toHaveBeenLastCalledWith({ id: 't2', revoked: true })
  })

  it('does not revoke when the confirmation is declined', async () => {
    mockConfirmPrompt.mockRejectedValueOnce(new Error('cancelled'))
    await expect(tokenCommand.parseAsync(['node', 'token', 'revoke', 't1'])).rejects.toThrow('cancelled')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('lists projects', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [{ id: 'p1' }] } })
    await projectCommand.parseAsync(['node', 'project', 'list'])
    expect(mockGet).toHaveBeenCalledWith('/api/projects')
    expect(mockOutput).toHaveBeenCalledWith([{ id: 'p1' }], expect.anything())
  })
})
