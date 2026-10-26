import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Readable } from 'node:stream'
import { mkdir, mkdtemp, readFile, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPut = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockGetText = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockDelete = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockOutputMutation = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()
const mockConfirmPrompt = jest.fn<(...args: unknown[]) => Promise<boolean>>()

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({
  createAuthenticatedClient: () => ({
    get: mockGet,
    getText: mockGetText,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  }),
}))

jest.unstable_mockModule('../../output/formatter.js', () => ({
  output: mockOutput,
  outputDetail: mockOutputDetail,
  outputMutation: mockOutputMutation,
}))

jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: {
    output: mockOutput,
    info: jest.fn(),
    success: mockSuccess,
    error: jest.fn(),
    warn: mockWarn,
    newline: jest.fn(),
  },
}))

jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

jest.unstable_mockModule('../../utils/prompt.js', () => ({
  confirmPrompt: mockConfirmPrompt,
}))

const { varCommand } = await import('../variables.js')
const { CLIError, ExitCode } = await import('../../utils/errors.js')

const variables = [
  {
    id: 'var-1',
    key: 'BASE_URL',
    type: 'variable' as const,
    isSecret: false,
    value: 'https://example.test',
  },
  {
    id: 'var-2',
    key: 'API_TOKEN',
    type: 'secret' as const,
    isSecret: true,
  },
  {
    id: 'var-3',
    key: 'UPLOAD',
    type: 'file' as const,
    isSecret: false,
    fileName: 'payload.json',
    fileSize: 128,
  },
]

/** Commander keeps option values on module-level singletons; reset them per test. */
function resetCommandState(command: import('commander').Command): void {
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), option.defaultValue)
  }
  for (const child of command.commands) resetCommandState(child)
}

describe('var command', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    resetCommandState(varCommand)
    mockConfirmPrompt.mockResolvedValue(true)
  })

  it('lists variables with the documented columns', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await varCommand.parseAsync(['node', 'var', 'list'])

    expect(mockGet).toHaveBeenCalledWith('/api/variables')
    expect(mockOutput).toHaveBeenCalledTimes(1)
    const [rows, options] = mockOutput.mock.calls[0] as [
      Record<string, unknown>[],
      { columns: { key: string }[] },
    ]
    expect(rows).toHaveLength(3)
    expect(options.columns.map((column) => column.key)).toEqual([
      'id',
      'key',
      'type',
      'fileName',
      'fileSize',
      'createdAt',
    ])
  })

  it('prints a normal variable value in detail output', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await varCommand.parseAsync(['node', 'var', 'get', 'BASE_URL'])

    expect(mockOutputDetail).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'BASE_URL', value: 'https://example.test' }),
    )
  })

  it('marks file variables with a placeholder instead of a value', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await varCommand.parseAsync(['node', 'var', 'get', 'UPLOAD'])

    expect(mockOutputDetail).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'UPLOAD', value: '[FILE: payload.json]' }),
    )
  })

  it('reports a not-found API error when the key does not exist', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await expect(varCommand.parseAsync(['node', 'var', 'get', 'MISSING'])).rejects.toMatchObject({
      name: 'ApiRequestError',
      exitCode: ExitCode.ApiError,
      message: 'Variable "MISSING" not found',
    })
  })

  it('creates a variable when the key is unused', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    mockPost.mockResolvedValueOnce({ data: { id: 'var-4' } })

    await varCommand.parseAsync(['node', 'var', 'set', 'NEW_KEY', 'plain-value'])

    expect(mockPost).toHaveBeenCalledWith('/api/variables', {
      key: 'NEW_KEY',
      value: 'plain-value',
      isSecret: false,
    })
    expect(mockSuccess).toHaveBeenCalledWith('Variable "NEW_KEY" created')
    expect(mockOutputMutation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'var-4', key: 'NEW_KEY', action: 'created' }),
    )
  })

  it('updates an existing variable and keeps its secret flag unless overridden', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    mockPut.mockResolvedValueOnce({ data: { id: 'var-2' } })

    await varCommand.parseAsync(['node', 'var', 'set', 'API_TOKEN', 'rotated'])

    expect(mockPut).toHaveBeenCalledWith('/api/variables/var-2', {
      key: 'API_TOKEN',
      value: 'rotated',
      isSecret: true,
    })
    expect(mockSuccess).toHaveBeenCalledWith('Variable "API_TOKEN" updated')
  })

  it('sends an explicit description only when one is provided', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    mockPut.mockResolvedValueOnce({ data: { id: 'var-1' } })

    await varCommand.parseAsync(['node', 'var', 'set', 'BASE_URL', 'https://new.test', '--description', 'primary url'])

    expect(mockPut).toHaveBeenCalledWith('/api/variables/var-1', {
      key: 'BASE_URL',
      value: 'https://new.test',
      isSecret: false,
      description: 'primary url',
    })
  })

  it('rejects file-type variables because the CLI cannot upload them', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await expect(varCommand.parseAsync(['node', 'var', 'set', 'UPLOAD', 'text'])).rejects.toMatchObject({
      exitCode: ExitCode.GeneralError,
      message: expect.stringContaining('File-type variables cannot be modified'),
    })
  })

  it.each([
    ['too short key', ['AB', 'value'], 'Variable key must be 4–20 characters.'],
    ['too long key', ['A'.repeat(21), 'value'], 'Variable key must be 4–20 characters.'],
  ])('rejects a %s before calling the API', async (_label, argv, message) => {
    await expect(varCommand.parseAsync(['node', 'var', 'set', ...argv])).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message,
    })
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('rejects passing both a positional value and --value-stdin', async () => {
    await expect(
      varCommand.parseAsync(['node', 'var', 'set', 'BASE_URL', 'value', '--value-stdin']),
    ).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: 'Use either a positional <value> or --value-stdin, not both.',
    })
  })

  it('requires a value or --value-stdin', async () => {
    await expect(varCommand.parseAsync(['node', 'var', 'set', 'BASE_URL'])).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: 'Missing variable value. Provide <value> or pass --value-stdin.',
    })
  })

  it('warns when a secret is passed as a command-line argument', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    mockPut.mockResolvedValueOnce({ data: { id: 'var-2' } })

    await varCommand.parseAsync(['node', 'var', 'set', 'API_TOKEN', 'visible', '--secret'])

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('exposes them to shell history'))
  })

  describe('reading values from stdin', () => {
    const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin')

    afterEach(() => {
      if (originalStdin) Object.defineProperty(process, 'stdin', originalStdin)
    })

    it('uses stdin and trims a single trailing newline', async () => {
      Object.defineProperty(process, 'stdin', {
        value: Readable.from(['secret-value\n']),
        configurable: true,
      })
      mockGet.mockResolvedValueOnce({ data: variables })
      mockPost.mockResolvedValueOnce({ data: { id: 'var-5' } })

      await varCommand.parseAsync(['node', 'var', 'set', 'NEW_KEY', '--value-stdin'])

      expect(mockPost).toHaveBeenCalledWith('/api/variables', {
        key: 'NEW_KEY',
        value: 'secret-value',
        isSecret: false,
      })
    })

    it('refuses stdin input larger than 1 MB', async () => {
      Object.defineProperty(process, 'stdin', {
        value: Readable.from([Buffer.alloc(1024 * 1024 + 1, 'a')]),
        configurable: true,
      })

      await expect(
        varCommand.parseAsync(['node', 'var', 'set', 'NEW_KEY', '--value-stdin']),
      ).rejects.toMatchObject({
        exitCode: ExitCode.GeneralError,
        message: 'Stdin input exceeds 1 MB limit.',
      })
      expect(mockGet).not.toHaveBeenCalled()
    })
  })

  it('deletes without prompting when --force is passed', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    mockDelete.mockResolvedValueOnce({ data: {} })

    await varCommand.parseAsync(['node', 'var', 'delete', 'API_TOKEN', '--force'])

    expect(mockConfirmPrompt).not.toHaveBeenCalled()
    expect(mockDelete).toHaveBeenCalledWith('/api/variables/var-2')
    expect(mockOutputMutation).toHaveBeenCalledWith({ id: 'var-2', key: 'API_TOKEN', deleted: true })
  })

  it('asks for confirmation and aborts when the operator declines', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })
    // confirmPrompt never resolves false: refusal throws, so this is the real
    // contract the command has to respect.
    mockConfirmPrompt.mockRejectedValueOnce(
      new CLIError('ABORTED: Operation cancelled.', ExitCode.ConfigError),
    )

    await expect(varCommand.parseAsync(['node', 'var', 'delete', 'API_TOKEN'])).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: 'ABORTED: Operation cancelled.',
    })
    expect(mockConfirmPrompt).toHaveBeenCalledWith('Delete variable "API_TOKEN"?', { default: false })
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('does not delete a key that does not exist', async () => {
    mockGet.mockResolvedValueOnce({ data: variables })

    await expect(varCommand.parseAsync(['node', 'var', 'delete', 'MISSING', '--force'])).rejects.toBeInstanceOf(
      CLIError,
    )
    expect(mockDelete).not.toHaveBeenCalled()
  })

  describe('file variables', () => {
    it('uploads a file as multipart form data to the project route', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'var-'))
      const file = join(dir, 'users.csv')
      await writeFile(file, 'a,b\n1,2\n')
      mockGet.mockResolvedValueOnce({ data: { project: { id: 'proj-1' } } })
      mockPost.mockResolvedValueOnce({ data: { success: true, data: { id: 'var-9' } } })

      await varCommand.parseAsync(['node', 'var', 'upload', 'USERS', file, '--description', 'seed'])

      expect(mockGet).toHaveBeenCalledWith('/api/context')
      const [path, form] = mockPost.mock.calls[0] as [string, FormData]
      expect(path).toBe('/api/projects/proj-1/variables')
      expect(form.get('key')).toBe('USERS')
      expect(form.get('description')).toBe('seed')
      expect((form.get('file') as File).name).toBe('users.csv')
      expect(mockOutputMutation).toHaveBeenCalledWith(expect.objectContaining({ id: 'var-9', key: 'USERS', action: 'created' }))
    })

    it('downloads a file variable to --out', async () => {
      const out = join(await mkdtemp(join(tmpdir(), 'var-')), 'out.json')
      mockGet.mockResolvedValueOnce({ data: variables }).mockResolvedValueOnce({ data: { project: { id: 'proj-1' } } })
      mockGetText.mockResolvedValueOnce({ data: '{"a":1}' })

      await varCommand.parseAsync(['node', 'var', 'download', 'UPLOAD', '--out', out])

      expect(mockGetText).toHaveBeenCalledWith('/api/projects/proj-1/variables/var-3/download')
      expect(await readFile(out, 'utf-8')).toBe('{"a":1}')
      expect((await stat(out)).mode & 0o777).toBe(0o600)
      expect(mockOutputMutation).toHaveBeenCalledWith({ id: 'var-3', key: 'UPLOAD', path: out })
    })

    it('validates the key, file type and size before reading or uploading', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'var-'))
      const csv = join(dir, 'users.csv')
      await writeFile(csv, 'a\n')
      await expect(varCommand.parseAsync(['node', 'var', 'upload', 'users', csv])).rejects.toThrow('uppercase letter')
      await expect(varCommand.parseAsync(['node', 'var', 'upload', 'USERS', join(dir, 'run.sh')])).rejects.toThrow('File type must be one of')
      await expect(varCommand.parseAsync(['node', 'var', 'upload', 'USERS', join(dir, 'missing.csv')])).rejects.toThrow('Cannot read')
      const folder = join(dir, 'folder.csv')
      await mkdir(folder)
      await expect(varCommand.parseAsync(['node', 'var', 'upload', 'USERS', folder])).rejects.toThrow('not a regular file')
      const big = join(dir, 'big.csv')
      await writeFile(big, '')
      await truncate(big, 5 * 1024 * 1024 + 1)
      await expect(varCommand.parseAsync(['node', 'var', 'upload', 'USERS', big])).rejects.toThrow('limited to 5 MB')
      expect(mockPost).not.toHaveBeenCalled()
    })

    it('writes downloads owner-only and refuses to overwrite without --force', async () => {
      const out = join(await mkdtemp(join(tmpdir(), 'var-')), 'out.json')
      await writeFile(out, 'old', { mode: 0o644 })
      mockGet.mockResolvedValue({ data: variables })
      mockGet.mockResolvedValueOnce({ data: variables }).mockResolvedValueOnce({ data: { project: { id: 'proj-1' } } })
      mockGetText.mockResolvedValue({ data: 'new' })
      await expect(varCommand.parseAsync(['node', 'var', 'download', 'UPLOAD', '--out', out])).rejects.toThrow('already exists')
      expect(await readFile(out, 'utf-8')).toBe('old')

      mockGet.mockResolvedValueOnce({ data: variables }).mockResolvedValueOnce({ data: { project: { id: 'proj-1' } } })
      await varCommand.parseAsync(['node', 'var', 'download', 'UPLOAD', '--out', out, '--force'])
      expect(await readFile(out, 'utf-8')).toBe('new')
      expect((await stat(out)).mode & 0o777).toBe(0o600)
    })

    it('refuses to download a non-file variable', async () => {
      mockGet.mockResolvedValueOnce({ data: variables })
      await expect(varCommand.parseAsync(['node', 'var', 'download', 'BASE_URL'])).rejects.toThrow('not a file variable')
      expect(mockGetText).not.toHaveBeenCalled()
    })
  })
})
