import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// The real formatter, logger and redaction: only the API client and spinner are stubbed.
const KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const mockPost = jest.fn<(...args: unknown[]) => Promise<{ data: unknown }>>()
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ post: mockPost }) }))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_t: string, fn: () => Promise<unknown>) => fn() }))

const { notificationCommand } = await import('../notifications.js')
const { setOutputFormat } = await import('../../output/formatter.js')
const { setRevealSecrets } = await import('../../utils/redact.js')

// What the server returns to an editor: the saved config, including the body template with the key in it.
const created = {
  id: 'np-1', name: 'On call', type: 'webhook',
  config: { preset: 'pagerduty', url: 'https://events.pagerduty.com/v2/enqueue', method: 'POST', bodyTemplate: JSON.stringify({ routing_key: KEY, event_action: '{{pagerDutyEventAction}}' }) },
}

describe('notification create --type pagerduty output', () => {
  let printed: string[]
  const spies: Array<ReturnType<typeof jest.spyOn>> = []
  beforeEach(() => {
    printed = []
    const capture = (...args: unknown[]) => { printed.push(args.map(String).join(' ')); return true }
    spies.push(jest.spyOn(process.stdout, 'write').mockImplementation(capture as never), jest.spyOn(process.stderr, 'write').mockImplementation(capture as never),
      jest.spyOn(console, 'log').mockImplementation(capture as never), jest.spyOn(console, 'error').mockImplementation(capture as never))
    process.env.PAGERDUTY_ROUTING_KEY = KEY
    mockPost.mockResolvedValue({ data: created })
    for (const option of notificationCommand.commands.find((c) => c.name() === 'create')!.options) notificationCommand.commands.find((c) => c.name() === 'create')!.setOptionValue(option.attributeName(), undefined)
  })
  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore())
    delete process.env.PAGERDUTY_ROUTING_KEY
    setRevealSecrets(false)
    setOutputFormat('table')
  })

  it.each(['table', 'json'] as const)('does not print the saved routing key (%s output)', async (format) => {
    setOutputFormat(format)
    await notificationCommand.parseAsync(['node', 'notification', 'create', '--type', 'pagerduty', '--name', 'On call'])
    expect(printed.length).toBeGreaterThan(0)
    expect(printed.join('\n')).not.toContain(KEY)
  })

  it('prints it only with --show-secrets (documented)', async () => {
    setOutputFormat('json')
    setRevealSecrets(true)
    await notificationCommand.parseAsync(['node', 'notification', 'create', '--type', 'pagerduty', '--name', 'On call'])
    expect(printed.join('\n')).toContain(KEY)
  })
})
