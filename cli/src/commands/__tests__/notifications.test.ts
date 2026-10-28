import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockGet = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockPut = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockDelete = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
const mockOutput = jest.fn<(...args: unknown[]) => void>()
const mockOutputDetail = jest.fn<(...args: unknown[]) => void>()
const mockOutputMutation = jest.fn<(...args: unknown[]) => void>()
const mockSuccess = jest.fn<(...args: unknown[]) => void>()
const mockDebug = jest.fn<(...args: unknown[]) => void>()
const mockWarn = jest.fn<(...args: unknown[]) => void>()
const mockConfirmPrompt = jest.fn<(...args: unknown[]) => Promise<void>>()

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
    debug: mockDebug,
    newline: jest.fn(),
  },
}))

jest.unstable_mockModule('../../utils/spinner.js', () => ({
  withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn(),
}))

jest.unstable_mockModule('../../utils/prompt.js', () => ({
  confirmPrompt: mockConfirmPrompt,
}))

const { notificationCommand } = await import('../notifications.js')
const { ExitCode } = await import('../../utils/errors.js')

function resetCommandState(command: import('commander').Command): void {
  for (const option of command.options) {
    command.setOptionValue(option.attributeName(), option.defaultValue)
  }
  for (const child of command.commands) resetCommandState(child)
}

describe('notification provider command', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    resetCommandState(notificationCommand)
    mockConfirmPrompt.mockResolvedValue(undefined)
  })

  it('lists providers with the documented columns', async () => {
    mockGet.mockResolvedValueOnce({
      data: [{ id: 'np-1', name: 'On call', type: 'slack', enabled: true }],
    })

    await notificationCommand.parseAsync(['node', 'notification', 'list'])

    expect(mockGet).toHaveBeenCalledWith('/api/notification-providers')
    const [rows, options] = mockOutput.mock.calls[0] as [
      Record<string, unknown>[],
      { columns: { key: string }[] },
    ]
    expect(rows).toHaveLength(1)
    expect(options.columns.map((column) => column.key)).toEqual([
      'id',
      'name',
      'type',
      'enabled',
      'lastUsed',
    ])
  })

  it('creates a provider and keeps the config name in sync with --name', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'np-2' } })

    await notificationCommand.parseAsync([
      'node',
      'notification',
      'create',
      '--type',
      'slack',
      '--name',
      'Release alerts',
      '--payload',
      '{"webhookUrl":"https://hooks.slack.test/abc"}',
    ])

    expect(mockPost).toHaveBeenCalledWith('/api/notification-providers', {
      name: 'Release alerts',
      type: 'slack',
      config: { name: 'Release alerts', webhookUrl: 'https://hooks.slack.test/abc' },
    })
    expect(mockSuccess).toHaveBeenCalledWith('Notification provider "Release alerts" created (np-2)')
  })

  it('rejects an unsupported provider type before calling the API', async () => {
    await expect(
      notificationCommand.parseAsync([
        'node',
        'notification',
        'create',
        '--type',
        'pagerduty',
        '--name',
        'Nope',
      ]),
    ).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: expect.stringContaining('Invalid provider type'),
    })
    expect(mockPost).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-object payload', '["not","an","object"]'],
    ['invalid JSON', '{oops'],
  ])('rejects %s', async (_label, payload) => {
    await expect(
      notificationCommand.parseAsync([
        'node',
        'notification',
        'create',
        '--type',
        'webhook',
        '--name',
        'Hooks',
        '--payload',
        payload,
      ]),
    ).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: 'Provider payload must be a valid JSON object',
    })
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects two payload aliases at once instead of silently picking one', async () => {
    await expect(
      notificationCommand.parseAsync([
        'node',
        'notification',
        'create',
        '--type',
        'webhook',
        '--name',
        'Hooks',
        '--payload',
        '{"url":"https://hooks.test/a"}',
        '--data',
        '{"url":"https://hooks.test/b"}',
      ]),
    ).rejects.toMatchObject({
      exitCode: ExitCode.ConfigError,
      message: 'Use only one of --payload, --data, or the legacy --config option',
    })
  })

  describe('update', () => {
    it('fails and writes nothing when no field is supplied', async () => {
      await expect(notificationCommand.parseAsync(['node', 'notification', 'update', 'np-1'])).rejects.toThrow('No fields to update. Use --name, --type, or --payload.')
      expect(mockGet).not.toHaveBeenCalled()
      expect(mockPut).not.toHaveBeenCalled()
    })

    it('omits the config when the stored configuration holds masked secrets', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          id: 'np-1',
          name: 'On call',
          type: 'slack',
          config: { webhookUrl: '********' },
          maskedFields: ['webhookUrl'],
        },
      })
      mockPut.mockResolvedValueOnce({ data: { id: 'np-1' } })

      await notificationCommand.parseAsync(['node', 'notification', 'update', 'np-1', '--name', 'Renamed'])

      // Sending the masked placeholder back would overwrite the real credential.
      expect(mockPut).toHaveBeenCalledWith('/api/notification-providers/np-1', {
        name: 'Renamed',
        type: 'slack',
      })
      expect(mockDebug).toHaveBeenCalledWith(
        'Skipping config field (contains masked secrets that cannot be round-tripped safely)',
      )
    })

    it('uses the operator-supplied config as-is instead of merging masked values', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          id: 'np-1',
          name: 'On call',
          type: 'slack',
          config: { webhookUrl: '********', channel: '#alerts' },
          maskedFields: ['webhookUrl'],
        },
      })
      mockPut.mockResolvedValueOnce({ data: { id: 'np-1' } })

      await notificationCommand.parseAsync([
        'node',
        'notification',
        'update',
        'np-1',
        '--payload',
        '{"webhookUrl":"https://hooks.slack.test/new"}',
      ])

      expect(mockPut).toHaveBeenCalledWith('/api/notification-providers/np-1', {
        name: 'On call',
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.test/new', name: 'On call' },
      })
    })

    it('round-trips an unmasked configuration and syncs its name', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          id: 'np-1',
          name: 'On call',
          type: 'email',
          config: { recipients: ['oncall@example.test'] },
        },
      })
      mockPut.mockResolvedValueOnce({ data: { id: 'np-1' } })

      await notificationCommand.parseAsync(['node', 'notification', 'update', 'np-1', '--name', 'Platform'])

      expect(mockPut).toHaveBeenCalledWith('/api/notification-providers/np-1', {
        name: 'Platform',
        type: 'email',
        config: { recipients: ['oncall@example.test'], name: 'Platform' },
      })
    })
  })

  describe('delete', () => {
    it('deletes without prompting when --force is passed', async () => {
      mockDelete.mockResolvedValueOnce({ data: {} })

      await notificationCommand.parseAsync(['node', 'notification', 'delete', 'np-1', '--force'])

      expect(mockConfirmPrompt).not.toHaveBeenCalled()
      expect(mockDelete).toHaveBeenCalledWith('/api/notification-providers/np-1')
      expect(mockOutputMutation).toHaveBeenCalledWith({ id: 'np-1', deleted: true })
    })

    it('requires confirmation without --force', async () => {
      mockDelete.mockResolvedValueOnce({ data: {} })

      await notificationCommand.parseAsync(['node', 'notification', 'delete', 'np-1'])

      expect(mockConfirmPrompt).toHaveBeenCalledWith('Delete notification provider np-1?', { default: false })
    })
  })

  describe('test', () => {
    it('reports a successful test send', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: true, message: 'Delivered to #alerts' } })

      await notificationCommand.parseAsync([
        'node',
        'notification',
        'test',
        '--type',
        'slack',
        '--payload',
        '{"webhookUrl":"https://hooks.slack.test/abc"}',
      ])

      expect(mockPost).toHaveBeenCalledWith('/api/notification-providers/test', {
        type: 'slack',
        config: { webhookUrl: 'https://hooks.slack.test/abc' },
      })
      expect(mockSuccess).toHaveBeenCalledWith('Delivered to #alerts')
    })

    it('surfaces the provider error as a general failure', async () => {
      mockPost.mockResolvedValueOnce({ data: { success: false, error: 'invalid webhook URL' } })

      await expect(
        notificationCommand.parseAsync([
          'node',
          'notification',
          'test',
          '--type',
          'slack',
          '--payload',
          '{"webhookUrl":"nope"}',
        ]),
      ).rejects.toMatchObject({
        exitCode: ExitCode.GeneralError,
        message: 'invalid webhook URL',
      })
    })

    it('requires a payload for a test send', async () => {
      await expect(
        notificationCommand.parseAsync(['node', 'notification', 'test', '--type', 'slack']),
      ).rejects.toMatchObject({
        exitCode: ExitCode.ConfigError,
        message: 'Provider payload is required; use --payload <json>',
      })
      expect(mockPost).not.toHaveBeenCalled()
    })
  })
})
