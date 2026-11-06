import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const MANAGED_REQ = '019a0000-0000-7000-8000-0000000000c1'
const DASHBOARD_REQ = '019a0000-0000-7000-8000-0000000000c2'
const JOB = '019a0000-0000-7000-8000-0000000000d1'

const deleted: string[] = []
const events: string[] = []
const del = jest.fn(async (path: string) => { events.push('delete'); deleted.push(path); return { data: {} } })
const get = jest.fn(async () => ({ data: [] }))
const fetchRequirements = jest.fn<() => Promise<Array<Record<string, unknown>>>>()
let config: Record<string, unknown> = {}

jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ get, delete: del }) }))
jest.unstable_mockModule('../../config/loader.js', () => ({ loadConfig: async () => ({ config, configPath: '/repo/supercheck.config.ts' }) }))
jest.unstable_mockModule('../../utils/managed.js', () => ({
  verifyContext: async () => ({ organization: { id: 'org' }, project: { id: 'project' } }),
  describeTarget: () => 'target',
  managedState: () => { events.push('state'); return { apply: (value: unknown) => value } },
  deploymentLock: () => { events.push('lock'); return () => { events.push('release') } },
}))
jest.unstable_mockModule('../../utils/resources.js', () => ({
  buildLocalResources: () => [],
  fetchAllPages: async (_client: unknown, path: string) => (path === '/api/jobs' ? [{ id: JOB, name: 'Nightly' }] : []),
  fetchRemoteRequirements: () => fetchRequirements(),
  getApiEndpoint: (type: string) => ({ requirement: '/api/requirements', job: '/api/jobs' })[type],
}))
jest.unstable_mockModule('../../utils/discovery.js', () => ({ discoverFiles: () => [] }))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn() }))
jest.unstable_mockModule('../../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn(), output: jest.fn() },
}))

const { destroyCommand, DELETE_ORDER } = await import('../destroy.js')
const { ApiRequestError } = await import('../../utils/errors.js')

beforeEach(() => {
  deleted.length = 0
  events.length = 0
  del.mockClear()
  fetchRequirements.mockReset()
  fetchRequirements.mockResolvedValue([{ id: MANAGED_REQ, title: 'Login' }, { id: DASHBOARD_REQ, title: 'Made in the dashboard' }])
  destroyCommand.setOptionValue('dryRun', false)
  destroyCommand.setOptionValue('force', false)
})

describe('destroy requirements', () => {
  it('deletes only requirements whose id is in the config, before jobs', async () => {
    config = { project: {}, requirements: [{ id: MANAGED_REQ, title: 'Login' }], jobs: [{ id: JOB, name: 'Nightly', tests: [] }] }
    await destroyCommand.parseAsync(['node', 'destroy', '--force'])
    expect(deleted).toEqual([`/api/requirements/${MANAGED_REQ}`, `/api/jobs/${JOB}`])
  })

  it('holds the deployment lock from before the state is read through the deletes and releases it afterwards', async () => {
    config = { project: {}, jobs: [{ id: JOB, name: 'Nightly', tests: [] }] }
    await destroyCommand.parseAsync(['node', 'destroy', '--force'])
    expect(events).toEqual(['lock', 'state', 'delete', 'release'])
  })

  it('does not take the lock for a dry run', async () => {
    config = { project: {}, jobs: [{ id: JOB, name: 'Nightly', tests: [] }] }
    await destroyCommand.parseAsync(['node', 'destroy', '--dry-run'])
    expect(events).toEqual(['state'])
  })

  it('never lists requirements when the config manages none', async () => {
    config = { project: {}, jobs: [{ id: JOB, name: 'Nightly', tests: [] }] }
    await destroyCommand.parseAsync(['node', 'destroy', '--force'])
    expect(fetchRequirements).not.toHaveBeenCalled()
    expect(deleted).toEqual([`/api/jobs/${JOB}`])
  })

  it('stops with an incomplete-inventory error before any delete when requirements cannot be listed', async () => {
    config = { project: {}, requirements: [{ id: MANAGED_REQ, title: 'Login' }] }
    fetchRequirements.mockRejectedValue(new ApiRequestError('boom', 500))
    await expect(destroyCommand.parseAsync(['node', 'destroy', '--force'])).rejects.toThrow('Incomplete inventory: could not fetch requirements')
    expect(del).not.toHaveBeenCalled()
  })
})

describe('destroy delete order', () => {
  it.each([
    ['statusPage', 'monitor'], ['requirement', 'test'], ['job', 'test'], ['monitor', 'test'],
    ['job', 'notificationProvider'], ['monitor', 'notificationProvider'],
    ['test', 'tag'], ['monitor', 'tag'], ['requirement', 'tag'],
  ])('deletes %s before %s', (dependent, dependency) => {
    expect(DELETE_ORDER.indexOf(dependent)).toBeGreaterThanOrEqual(0)
    expect(DELETE_ORDER.indexOf(dependent)).toBeLessThan(DELETE_ORDER.indexOf(dependency))
  })
})
