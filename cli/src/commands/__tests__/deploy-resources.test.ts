import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const T1 = '019a0000-0000-7000-8000-000000000001'
const M1 = '019a0000-0000-7000-8000-0000000000a1'
const calls: Array<{ method: string; path: string; body?: unknown }> = []
let tagPostError: Error | undefined
const post = jest.fn(async (path: string, body?: unknown) => {
  calls.push({ method: 'POST', path, body })
  if (path.endsWith('/tags')) {
    if (tagPostError) throw tagPostError
    return { data: [] }
  }
  const id = path === '/api/status-pages' ? '019a0000-0000-7000-8000-0000000000c1' : path.includes('/components') ? 'comp' : '019a0000-0000-7000-8000-0000000000b1'
  if (path === '/api/requirements') return { data: { requirement: { id } } }
  if (path === '/api/status-pages') return { data: { statusPage: { id } } }
  if (path === '/api/monitors') return { data: { monitor: { id: M1 } } }
  if (path === '/api/tests') return { data: { test: { id: T1 } } }
  return { data: { component: { id } } }
})
const put = jest.fn(async (path: string, body?: unknown) => { calls.push({ method: 'PUT', path, body }); return { data: {} } })
const del = jest.fn(async () => ({ data: {} }))
const get = jest.fn(async (path: string) => ({ data: path === '/api/tags' ? [{ id: 'tag-smoke', name: 'smoke' }] : { components: [] } }))
const record = jest.fn()

let local: unknown[] = []
let remote: unknown[] = []
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ post, put, delete: del, get, getText: async () => ({ data: '' }) }) }))
jest.unstable_mockModule('../../config/loader.js', () => ({ loadConfig: async () => ({ config: {} }) }))
jest.unstable_mockModule('../../utils/resources.js', () => ({
  buildLocalResources: () => local,
  fetchRemoteResources: async () => remote,
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
const { logger } = await import('../../utils/logger.js')

beforeEach(() => {
  calls.length = 0
  remote = []
  tagPostError = undefined
  post.mockClear(); put.mockClear(); record.mockClear(); (logger.error as jest.Mock).mockClear()
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
      'POST /api/requirements', // capability probes, before any write
      'PUT /api/status-pages/00000000-0000-4000-8000-000000000000',
      'POST /api/tests',
      'POST /api/monitors',
      'POST /api/requirements',
      'POST /api/status-pages',
      'POST /api/status-pages/019a0000-0000-7000-8000-0000000000c1/components',
      'PUT /api/status-pages/019a0000-0000-7000-8000-0000000000c1',
    ])
    const writes = calls.slice(2)
    expect(writes[2].body).toEqual({ title: 'Login', tags: ['auth'], testIds: [T1] })
    expect(writes[3].body).toEqual({ name: 'Acme' })
    expect(writes[4].body).toEqual({ name: 'Web', monitorIds: [M1], position: 0 })
    expect(writes[5].body).toEqual({ status: 'published' })
    expect(JSON.stringify(calls)).not.toContain('subdomain')
  })

  it('sends a requirement priority of "" as null so the server clears it', async () => {
    local = [{ type: 'requirement', name: 'Login', definition: { title: 'Login', priority: '' } }]
    await deployCommand.parseAsync(['node', 'deploy', '--force'])
    expect(calls.at(-1)).toEqual({ method: 'POST', path: '/api/requirements', body: { title: 'Login', priority: null } })
  })

  it('fails before any write when a status page definition is invalid', async () => {
    local = [{ type: 'statusPage', name: 'Acme', definition: { name: 'Acme', components: [{ name: 'A', monitors: [] }, { name: 'A', monitors: [] }] } }]
    await expect(deployCommand.parseAsync(['node', 'deploy', '--force'])).rejects.toThrow('two components named')
    expect(post).not.toHaveBeenCalled()
  })

  describe('preflightDeploy', () => {
    const change = (type: string, action: string, name: string, definition: Record<string, unknown> = {}) => ({ type, action, name, local: { type, name, definition } }) as never

    it('fails on unknown test/monitor tags before any write, accepting case-insensitive and same-deploy tags', async () => {
      const client = { get: async () => ({ data: [{ id: 't1', name: 'Smoke' }] }), post: async () => { throw new ApiRequestError('Invalid request body', 400) } } as never
      await expect(preflightDeploy(client, [change('test', 'create', 'a.pw.ts', { tags: ['smoke', 'New', 'nope'] }), change('tag', 'create', 'new')], [])).rejects.toThrow('tag "nope"')
      await expect(preflightDeploy(client, [change('monitor', 'update', 'm', { tags: ['SMOKE'] }), change('requirement', 'create', 'r', { tags: ['anything'] })], [])).resolves.toBeUndefined()
    })

    it('reports an upgrade hint when the server lacks the requirement or monitor tag APIs', async () => {
      const old = { get: async () => { throw new ApiRequestError('x', 404) }, post: async () => { throw new ApiRequestError('Method Not Allowed', 405) } } as never
      await expect(preflightDeploy(old, [change('requirement', 'create', 'r')], [])).rejects.toThrow('does not support managing requirements')
      const tagsOk = { get: async (path: string) => { if (path.endsWith('/tags') && path.includes('/monitors/')) throw new ApiRequestError('x', 404); return { data: [{ id: 't', name: 'a' }] } } } as never
      await expect(preflightDeploy(tagsOk, [change('monitor', 'create', 'm', { tags: ['a'] })], ['m1'])).rejects.toThrow('monitor tag assignment')
    })

    it('probes requirement support with a body the server rejects before writing, never the CSV export', async () => {
      const post = jest.fn<(path: string, body: unknown) => Promise<never>>(async () => { throw new ApiRequestError('Invalid request body', 400) })
      const getText = jest.fn()
      await expect(preflightDeploy({ post, getText } as never, [change('requirement', 'create', 'r')], [])).resolves.toBeUndefined()
      expect(post).toHaveBeenCalledWith('/api/requirements', {})
      expect(getText).not.toHaveBeenCalled()
      const denied = { post: async () => { throw new ApiRequestError('Insufficient permissions', 403) } } as never
      await expect(preflightDeploy(denied, [change('requirement', 'create', 'r')], [])).rejects.toThrow('Insufficient permissions')
    })

    it('rejects more than 10 distinct tags on a test or monitor before any write', async () => {
      const get = jest.fn()
      const tags = Array.from({ length: 11 }, (_, i) => `t${i}`)
      await expect(preflightDeploy({ get } as never, [change('test', 'create', 'a.pw.ts', { tags })], [])).rejects.toThrow(/at most 10 tags/)
      await expect(preflightDeploy({ get } as never, [change('monitor', 'update', 'm', { tags })], [])).rejects.toThrow(/at most 10 tags/)
      expect(get).not.toHaveBeenCalled()
      const client = { get: async () => ({ data: [{ id: 't', name: 'a' }] }) } as never
      await expect(preflightDeploy(client, [change('test', 'create', 'a.pw.ts', { tags: Array.from({ length: 12 }, () => 'A') })], [])).resolves.toBeUndefined()
    })

    it('treats a JSON not-found 404 from the status page probe as supported, but an HTML route-missing 404 as old', async () => {
      const notFound = { put: async () => { throw new ApiRequestError('x', 404, { error: 'Status page not found' }) } } as never
      await expect(preflightDeploy(notFound, [change('statusPage', 'update', 'Acme')], [])).resolves.toBeUndefined()
      const missingRoute = { put: async () => { throw new ApiRequestError('x', 404) } } as never
      await expect(preflightDeploy(missingRoute, [change('statusPage', 'update', 'Acme')], [])).rejects.toThrow(OLD_SERVER_STATUS_PAGE_MESSAGE)
    })

    it('probes status page write support before any write: 405 means an older server, 400 means supported', async () => {
      const put = jest.fn<(path: string, body: unknown) => Promise<never>>(async () => { throw new ApiRequestError('Method Not Allowed', 405) })
      await expect(preflightDeploy({ put } as never, [change('statusPage', 'create', 'Acme')], [])).rejects.toThrow(OLD_SERVER_STATUS_PAGE_MESSAGE)
      expect(put).toHaveBeenCalledWith('/api/status-pages/00000000-0000-4000-8000-000000000000', {})

      const current = { put: async () => { throw new ApiRequestError('No fields to update', 400) } } as never
      await expect(preflightDeploy(current, [change('statusPage', 'update', 'Acme')], [])).resolves.toBeUndefined()

      const denied = { put: async () => { throw new ApiRequestError('Insufficient permissions to update status pages', 403) } } as never
      await expect(preflightDeploy(denied, [change('statusPage', 'update', 'Acme')], [])).rejects.toThrow('Insufficient permissions')

      const offline = { put: async () => { throw new Error('socket hang up') } } as never
      await expect(preflightDeploy(offline, [change('statusPage', 'create', 'Acme')], [])).rejects.toThrow('socket hang up')
    })
  })

  describe('tags applied after the write', () => {
    const monitor = { type: 'monitor', name: 'API', definition: { name: 'API', type: 'website', target: 'https://example.com', tags: ['smoke'] } }
    const errors = () => (logger.error as jest.Mock).mock.calls.map((call) => String(call[0])).join('\n')

    it('maps a missing monitor tag route to the upgrade hint and keeps the created id', async () => {
      local = [monitor]
      tagPostError = new ApiRequestError('Not Found', 404)
      await expect(deployCommand.parseAsync(['node', 'deploy', '--force'])).rejects.toThrow('1 failed')
      expect(errors()).toContain('does not support monitor tag assignment')
      expect(record).toHaveBeenCalledWith('monitor', 'API', M1, undefined)
    })

    it('reports a saved resource whose tags failed', async () => {
      local = [{ type: 'test', name: 'playwright/home.pw.ts', definition: { title: 'Home', testType: 'playwright', script: "test('x')", tags: ['smoke'] } }]
      tagPostError = new ApiRequestError('Internal Server Error', 500)
      await expect(deployCommand.parseAsync(['node', 'deploy', '--force'])).rejects.toThrow('1 failed')
      expect(errors()).toContain('Saved, but tags were not applied')
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/tests', `POST /api/tests/${T1}/tags`])
    })

    it('applies a tag change on update after the PUT, with the id encoded', async () => {
      local = [{ ...monitor, id: M1 }]
      remote = [{ id: M1, type: 'monitor', name: 'API', raw: { name: 'API', type: 'website', target: 'https://example.com', tags: [] } }]
      await deployCommand.parseAsync(['node', 'deploy', '--force'])
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`PUT /api/monitors/${M1}`, `POST /api/monitors/${M1}/tags`])
      expect(calls[1].body).toEqual({ tagIds: ['tag-smoke'] })
    })

    it('sends no status page probe and writes nothing on --dry-run', async () => {
      local = [{ type: 'statusPage', name: 'Acme', definition: { name: 'Acme' } }]
      await deployCommand.parseAsync(['node', 'deploy', '--dry-run'])
      expect(put).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
    })
  })
})
