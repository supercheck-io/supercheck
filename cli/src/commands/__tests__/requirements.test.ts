import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockGetText = jest.fn<(...args: unknown[]) => Promise<{ data: string }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPut = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockDelete = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockOutputMutation = jest.fn<(...args: unknown[]) => void>()
const mockOutputPagination = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockConfirmPrompt = jest.fn<(...args: unknown[]) => Promise<boolean>>()
const mockListItems = jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>[]>>()
let outputFormat = 'table'

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({ get: mockGet, getText: mockGetText, post: mockPost, put: mockPut, delete: mockDelete }),
}))
jest.unstable_mockModule('../../output/formatter.js', () => ({
  getOutputFormat: () => outputFormat, output: mockOutput, outputDetail: mockOutputDetail, outputMutation: mockOutputMutation, outputPagination: mockOutputPagination,
}))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { output: mockOutput, info: jest.fn(), success: mockSuccess, error: jest.fn(), warn: jest.fn(), newline: jest.fn() },
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))
jest.unstable_mockModule('../../utils/prompt.js', () => ({ confirmPrompt: mockConfirmPrompt }))
jest.unstable_mockModule('../../utils/resources.js', () => ({ fetchRequirementListItems: mockListItems, dedupeTagNames: (names: string[]) => {
    const seen = new Map<string, string>()
    for (const n of names) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n)
    return [...seen.values()].sort()
  },
  }))

const { requirementCommand } = await import('../requirements.js')
const { CLIError } = await import('../../utils/errors.js')

const ID = '019a0000-0000-7000-8000-0000000000b1'
const T1 = '019a0000-0000-7000-8000-000000000001'
const T2 = '019a0000-0000-7000-8000-000000000002'
const dto = {
  id: ID, title: 'Users can log in', description: null, priority: 'high', tags: ['auth'], externalId: null, externalUrl: null, testIds: [T1],
  coverage: { status: 'covered', linkedTestCount: 1, passedTestCount: 1, failedTestCount: 0, lastEvaluatedAt: null },
  createdAt: null, updatedAt: null,
}

function resetCommandState(command: import('commander').Command): void {
  for (const option of command.options) command.setOptionValue(option.attributeName(), option.defaultValue)
  for (const child of command.commands) resetCommandState(child)
}
const run = (...args: string[]) => requirementCommand.parseAsync(['node', 'requirement', ...args])

describe('requirement command', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    resetCommandState(requirementCommand)
    mockConfirmPrompt.mockResolvedValue(true)
    outputFormat = 'table'
  })

  it('is also available as `requirements`', () => {
    expect(requirementCommand.aliases()).toContain('requirements')
  })

  it('lists with filters, columns and pagination', async () => {
    mockGet.mockResolvedValueOnce({ data: { data: [{ id: ID, title: 'R' }], total: 120, page: 2, pageSize: 50 } })
    await run('list', '--search', 'login', '--priority', 'HIGH', '--status', 'missing', '--page', '2')
    expect(mockGet).toHaveBeenCalledWith('/api/requirements', { page: '2', pageSize: '50', search: 'login', priority: 'high', status: 'missing' })
    const [, options] = mockOutput.mock.calls[0] as [unknown, { columns: { key: string }[] }]
    expect(options.columns.map((c) => c.key)).toEqual(['id', 'title', 'priority', 'coverageStatus', 'linkedTestCount'])
    expect(mockOutputPagination).toHaveBeenCalledWith({ page: 2, total: 120, totalPages: 3 })
  })

  it('rejects bad list filters', async () => {
    await expect(run('list', '--priority', 'urgent')).rejects.toThrow('Invalid priority')
    await expect(run('list', '--status', 'weird')).rejects.toThrow('Invalid status')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('gets a requirement with flattened coverage', async () => {
    mockGet.mockResolvedValueOnce({ data: { requirement: dto } })
    await run('get', ID)
    expect(mockGet).toHaveBeenCalledWith(`/api/requirements/${ID}`)
    expect(mockOutputDetail).toHaveBeenCalledWith(expect.objectContaining({ id: ID, coverageStatus: 'covered', linkedTestCount: 1, tags: ['auth'] }))
  })

  it('rejects non-UUID ids before calling the API', async () => {
    await expect(run('get', 'nope')).rejects.toBeInstanceOf(CLIError)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('creates with repeatable and comma-separated tags and tests', async () => {
    mockPost.mockResolvedValueOnce({ data: { requirement: dto } })
    await run('create', '--title', 'Users can log in', '--priority', 'High', '--tag', 'Auth,core', '--tag', 'auth', '--external-id', 'J-1',
      '--external-url', 'https://x.test/J-1', '--description', 'd', '--test', `${T1},${T2}`, '--test', T1)
    expect(mockPost).toHaveBeenCalledWith('/api/requirements', {
      title: 'Users can log in', description: 'd', priority: 'high', tags: ['Auth', 'core'], externalId: 'J-1', externalUrl: 'https://x.test/J-1', testIds: [T1, T2],
    })
    expect(mockSuccess).toHaveBeenCalled()
    expect(mockOutputMutation).toHaveBeenCalledWith(expect.objectContaining({ id: ID, action: 'created' }))
  })

  it('validates priority and test ids on create', async () => {
    await expect(run('create', '--title', 'x', '--priority', 'nope')).rejects.toThrow('Invalid priority')
    await expect(run('create', '--title', 'x', '--test', 'not-a-uuid')).rejects.toThrow('valid test ID')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('updates only the given fields and supports clearing sets', async () => {
    mockPut.mockResolvedValue({ data: { requirement: dto } })
    await run('update', ID, '--title', 'New')
    expect(mockPut).toHaveBeenLastCalledWith(`/api/requirements/${ID}`, { title: 'New' })
    resetCommandState(requirementCommand)
    await run('update', ID, '--clear-tags', '--clear-tests')
    expect(mockPut).toHaveBeenLastCalledWith(`/api/requirements/${ID}`, { tags: [], testIds: [] })
  })

  it('refuses an empty or contradictory update', async () => {
    await expect(run('update', ID)).rejects.toThrow('Nothing to update')
    resetCommandState(requirementCommand)
    await expect(run('update', ID, '--tag', 'a', '--clear-tags')).rejects.toThrow('not both')
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('deletes after confirmation, or skips it with --force', async () => {
    mockDelete.mockResolvedValue({ data: { success: true } })
    await run('delete', ID)
    expect(mockConfirmPrompt).toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith(`/api/requirements/${ID}`)
    mockConfirmPrompt.mockClear()
    resetCommandState(requirementCommand)
    await run('delete', ID, '--force')
    expect(mockConfirmPrompt).not.toHaveBeenCalled()
    expect(mockOutputMutation).toHaveBeenLastCalledWith({ id: ID, deleted: true })
  })

  it('does not delete when the confirmation is declined', async () => {
    mockConfirmPrompt.mockRejectedValueOnce(new CLIError('Aborted', 1))
    await expect(run('delete', ID)).rejects.toThrow('Aborted')
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('links and unlinks tests', async () => {
    mockPost.mockResolvedValueOnce({ data: { requirement: dto } })
    await run('link', ID, T1, T2, T1)
    expect(mockPost).toHaveBeenCalledWith(`/api/requirements/${ID}/tests`, { testIds: [T1, T2] })
    mockDelete.mockResolvedValueOnce({ data: { requirement: dto } })
    await run('unlink', ID, T2)
    expect(mockDelete).toHaveBeenCalledWith(`/api/requirements/${ID}/tests`, { testIds: [T2] })
  })

  it('shows coverage for one requirement and a summary for all', async () => {
    mockGet.mockResolvedValueOnce({ data: { requirement: dto } })
    await run('coverage', ID)
    expect(mockOutputDetail).toHaveBeenCalledWith({
      id: ID, title: dto.title, status: 'covered', linkedTestCount: 1, passedTestCount: 1, failedTestCount: 0, lastEvaluatedAt: null,
    })

    mockListItems.mockResolvedValueOnce([{ coverageStatus: 'covered' }, { coverageStatus: 'missing' }, { coverageStatus: 'missing' }, {}])
    await run('coverage')
    const [rows] = mockOutput.mock.calls.at(-1) as [Array<{ status: string; count: number }>]
    expect(rows).toEqual([{ status: 'covered', count: 1 }, { status: 'failing', count: 0 }, { status: 'missing', count: 3 }])
  })

  describe('export', () => {
    let dir: string
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'supercheck-req-export-')) })
    afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

    it('prints CSV to stdout', async () => {
      mockGetText.mockResolvedValueOnce({ data: 'id,title\n1,A\n' })
      await run('export')
      expect(mockGetText).toHaveBeenCalledWith('/api/requirements/export')
      expect(mockOutput).toHaveBeenCalledWith('id,title\n1,A')
    })

    it('wraps the CSV in JSON with --json', async () => {
      outputFormat = 'json'
      mockGetText.mockResolvedValueOnce({ data: 'id,title\n1,A\n' })
      await run('export')
      expect(mockOutputDetail).toHaveBeenCalledWith({ format: 'csv', content: 'id,title\n1,A\n' })
      expect(mockOutput).not.toHaveBeenCalled()
    })

    it('writes to a new file and refuses to overwrite without --force', async () => {
      const file = join(dir, 'req.csv')
      mockGetText.mockResolvedValue({ data: 'id,title\n1,A\n' })
      await run('export', '--output', file)
      expect(readFileSync(file, 'utf8')).toBe('id,title\n1,A\n')

      writeFileSync(file, 'keep me')
      resetCommandState(requirementCommand)
      await expect(run('export', '--output', file)).rejects.toThrow('already exists')
      expect(readFileSync(file, 'utf8')).toBe('keep me')

      resetCommandState(requirementCommand)
      await run('export', '--output', file, '--force')
      expect(readFileSync(file, 'utf8')).toBe('id,title\n1,A\n')
      expect(existsSync(file)).toBe(true)
    })

    it('writes owner-only and refuses to follow a symlink even with --force', async () => {
      mockGetText.mockResolvedValue({ data: 'id,title\n1,A\n' })
      const file = join(dir, 'fresh.csv')
      await run('export', '--output', file)
      expect(statSync(file).mode & 0o777).toBe(0o600)

      const shared = join(dir, 'shared.csv')
      writeFileSync(shared, 'old', { mode: 0o644 })
      resetCommandState(requirementCommand)
      await run('export', '--output', shared, '--force')
      expect(statSync(shared).mode & 0o777).toBe(0o600)

      const target = join(dir, 'target.txt')
      const link = join(dir, 'link.csv')
      writeFileSync(target, 'keep me')
      symlinkSync(target, link)
      resetCommandState(requirementCommand)
      await expect(run('export', '--output', link, '--force')).rejects.toThrow('symbolic link')
      expect(readFileSync(target, 'utf8')).toBe('keep me')
    })
  })
})
