import { beforeEach, describe, expect, it, jest } from '@jest/globals'
const remove = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined)
const plan = jest.fn()
const remote = { id: 'unrelated', type: 'monitor' as const, name: 'Dashboard monitor', raw: {} }
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ delete: remove }) }))
jest.unstable_mockModule('../../config/loader.js', () => ({ loadConfig: async () => ({ config: {} }) }))
jest.unstable_mockModule('../../utils/resources.js', () => ({ buildLocalResources: () => [], fetchRemoteResources: async () => [remote], getApiEndpoint: () => '/api/monitors' }))
jest.unstable_mockModule('../../utils/reconcile.js', () => ({ reconcile: () => [{ action: 'delete', ...remote, remote }], formatChangePlan: plan }))
jest.unstable_mockModule('../../utils/discovery.js', () => ({ discoverFiles: () => [] }))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn() }))
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), success: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn() } }))
const { deployCommand } = await import('../deploy.js')
const { diffCommand } = await import('../diff.js')

beforeEach(() => {
  remove.mockClear(); plan.mockClear()
  deployCommand.setOptionValue('delete', false); deployCommand.setOptionValue('dryRun', false)
  diffCommand.setOptionValue('delete', false)
})

describe('deletion opt-in', () => {
  it('preserves unrelated remote resources during default deploy', async () => {
    await deployCommand.parseAsync(['node', 'deploy', '--force'])
    expect(remove).not.toHaveBeenCalled()
  })
  it('previews and applies deletions only with explicit --delete', async () => {
    await deployCommand.parseAsync(['node', 'deploy', '--force', '--delete', '--dry-run'])
    expect(plan.mock.calls[0][0]).toEqual([expect.objectContaining({ action: 'delete' })])
    expect(remove).not.toHaveBeenCalled()
    deployCommand.setOptionValue('dryRun', false)
    await deployCommand.parseAsync(['node', 'deploy', '--force', '--delete'])
    expect(remove).toHaveBeenCalledWith('/api/monitors/unrelated')
  })
  it('retains --no-delete and makes diff follow deploy defaults', async () => {
    await deployCommand.parseAsync(['node', 'deploy', '--force', '--no-delete'])
    expect(remove).not.toHaveBeenCalled()
    await diffCommand.parseAsync(['node', 'diff'])
    expect(plan).toHaveBeenLastCalledWith([])
    await diffCommand.parseAsync(['node', 'diff', '--delete'])
    expect(plan).toHaveBeenLastCalledWith([expect.objectContaining({ action: 'delete' })])
  })
})
