import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Readable } from 'node:stream'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPut = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
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
})
