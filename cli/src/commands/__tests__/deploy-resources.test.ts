import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const T1 = '019a0000-0000-7000-8000-000000000001'
const M1 = '019a0000-0000-7000-8000-0000000000a1'
const calls: Array<{ method: string; path: string; body?: unknown }> = []
const post = jest.fn(async (path: string, body?: unknown) => {
  calls.push({ method: 'POST', path, body })
  const id = path === '/api/status-pages' ? '019a0000-0000-7000-8000-0000000000c1' : path.includes('/components') ? 'comp' : '019a0000-0000-7000-8000-0000000000b1'
  if (path === '/api/requirements') return { data: { requirement: { id } } }
  if (path === '/api/status-pages') return { data: { statusPage: { id } } }
  if (path === '/api/monitors') return { data: { monitor: { id: M1 } } }
  if (path === '/api/tests') return { data: { test: { id: T1 } } }
  return { data: { component: { id } } }
})
const put = jest.fn(async (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return { data: {} } })
const del = jest.fn(async () => ({ data: {} }))
const get = jest.fn(async () => ({ data: { components: [] } }))
const record = jest.fn()

let local: unknown[] = []
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ post, put, delete: del, get, getText: async () => ({ data: '' }) }) }))
jest.unstable_mockModule('../../config/loader.js', () => ({ loadConfig: async () => ({ config: {} }) }))
jest.unstable_mockModule('../../utils/resources.js', () => ({
  buildLocalResources: () => local,
  fetchRemoteResources: async () => [],
  getApiEndpoint: (type: string) => ({ requirement: '/api/requirements', statusPage: '/api/status-pages', monitor: '/api/monitors', test: '/api/tests' })[type],
}))
jest.unstable_mockModule('../../utils/validation.js', () => ({
  normalizeTestTypeForApi: () => 'browser', validateScripts: async () => [], validateScriptTypeMatch: () => null,
}))
jest.unstable_mockModule('../../utils/spinner.js', () => ({ withSpinner: async (_text: string, fn: () => Promise<unknown>) => fn() }))
jest.unstable_mockModule('../../utils/logger.js', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn(), newline: jest.fn(), header: jest.fn(), output: jest.fn() } }))
jest.unstable_mockModule('../../utils/managed.js', () => ({
  describeTarget: () => 'target',
  verifyContext: async () => ({ organization: { id: 'org' }, project: { id: 'project' } }),
  deploymentLock: () => () => undefined,
  rejectAmbiguousCreates: () => undefined,
  managedState: () => ({
    path: 'state.json',
    apply: (value: unknown) => value,
    resolveTests: (value: unknown) => value,
    record,
    resolve: (_type: string, ref: string) => {
      if (ref === 'playwright/home.pw.ts') return T1
      if (ref === 'API') return M1
      return ref
    },
  }),
}))
const { deployCommand, preflightDeploy } = await import('../deploy.js')
const { ApiRequestError } = await import('../../utils/errors.js')
const { OLD_SERVER_STATUS_PAGE_MESSAGE } = await import('../../utils/status-pages.js')

beforeEach(() => {
  calls.length = 0
  post.mockClear(); put.mockClear(); record.mockClear()
  deployCommand.setOptionValue('delete', false); deployCommand.setOptionValue('dryRun', false); deployCommand.setOptionValue('force', false)
})

describe('deploy requirements and status pages', () => {
  it('applies in dependency order and maps requirement tests to testIds', async () => {
    local = [
      { type: 'statusPage', name: 'Acme', definition: { name: 'Acme', subdomain: 'ignored', status: 'published', components: [{ name: 'Web', monitors: ['API'], position: 0 }] } },
      { type: 'requirement', name: 'Login', definition: { title: 'Login', tags: ['auth'], tests: ['playwright/home.pw.ts'] } },
      { type: 'monitor', name: 'API', definition: { name: 'API', type: 'website', target: 'https://example.com' } },
      { type: 'test', name: 'playwright/home.pw.ts', definition: { title: 'Home', testType: 'playwright', script: "test('x')" } },
    ]
    await deployCommand.parseAsync(['node', 'deploy', '--force'])

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'PUT /api/status-pages/00000000-0000-4000-8000-000000000000', // capability probe, before any write
      'POST /api/tests',
      'POST /api/monitors',
      'POST /api/requirements',
      'POST /api/status-pages',
      'POST /api/status-pages/019a0000-0000-7000-8000-0000000000c1/components',
      'PUT /api/status-pages/019a0000-0000-7000-8000-0000000000c1',
    ])
    const writes = calls.slice(1)
    expect(writes[2].body).toEqual({ title: 'Login', tags: ['auth'], testIds: [T1] })
    expect(writes[3].body).toEqual({ name: 'Acme' })
    expect(writes[4].body).toEqual({ name: 'Web', monitorIds: [M1], position: 0 })
    expect(writes[5].body).toEqual({ status: 'published' })
    expect(JSON.stringify(calls)).not.toContain('subdomain')
  })

  it('fails before any write when a status page definition is invalid', async () => {
    local = [{ type: 'statusPage', name: 'Acme', definition: { name: 'Acme', components: [{ name: 'A', monitors: [] }, { name: 'A', monitors: [] }] } }]
    await expect(deployCommand.parseAsync(['node', 'deploy', '--force'])).rejects.toThrow('two components named')
    expect(post).not.toHaveBeenCalled()
  })

  describe('preflightDeploy', () => {
    const change = (type: string, action: string, name: string, definition: Record<string, unknown> = {}) => ({ type, action, name, local: { type, name, definition } }) as never

    it('fails on unknown test/monitor tags before any write, accepting case-insensitive and same-deploy tags', async () => {
      const client = { get: async () => ({ data: [{ id: 't1', name: 'Smoke' }] }), getText: async () => ({ data: '' }) } as never
      await expect(preflightDeploy(client, [change('test', 'create', 'a.pw.ts', { tags: ['smoke', 'New', 'nope'] }), change('tag', 'create', 'new')], [])).rejects.toThrow('tag "nope"')
      await expect(preflightDeploy(client, [change('monitor', 'update', 'm', { tags: ['SMOKE'] }), change('requirement', 'create', 'r', { tags: ['anything'] })], [])).resolves.toBeUndefined()
    })

    it('reports an upgrade hint when the server lacks the requirement or monitor tag APIs', async () => {
      const old = { get: async () => { throw new ApiRequestError('x', 404) }, getText: async () => { throw new ApiRequestError('x', 404) } } as never
      await expect(preflightDeploy(old, [change('requirement', 'create', 'r')], [])).rejects.toThrow('does not support managing requirements')
      const tagsOk = { get: async (path: string) => { if (path.endsWith('/tags') && path.includes('/monitors/')) throw new ApiRequestError('x', 404); return { data: [{ id: 't', name: 'a' }] } } } as never
      await expect(preflightDeploy(tagsOk, [change('monitor', 'create', 'm', { tags: ['a'] })], ['m1'])).rejects.toThrow('monitor tag assignment')
    })

    it('probes status page write support before any write: 405 means an older server, 400 means supported', async () => {
      const put = jest.fn<(path: string, body: unknown) => Promise<never>>(async () => { throw new ApiRequestError('Method Not Allowed', 405) })
      await expect(preflightDeploy({ put } as never, [change('statusPage', 'create', 'Acme')], [])).rejects.toThrow(OLD_SERVER_STATUS_PAGE_MESSAGE)
      expect(put).toHaveBeenCalledWith('/api/status-pages/00000000-0000-4000-8000-000000000000', {})

      const current = { put: async () => { throw new ApiRequestError('No fields to update', 400) } } as never
      await expect(preflightDeploy(current, [change('statusPage', 'update', 'Acme')], [])).resolves.toBeUndefined()

      const offline = { put: async () => { throw new Error('socket hang up') } } as never
      await expect(preflightDeploy(offline, [change('statusPage', 'create', 'Acme')], [])).rejects.toThrow('socket hang up')
    })
  })
})
