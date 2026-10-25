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
jest.unstable_mockModule('../../api/authenticated-client.js', () => ({ createAuthenticatedClient: () => ({ post, put, delete: del, get }) }))
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
const { deployCommand } = await import('../deploy.js')

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
      'POST /api/tests',
      'POST /api/monitors',
      'POST /api/requirements',
      'POST /api/status-pages',
      'POST /api/status-pages/019a0000-0000-7000-8000-0000000000c1/components',
      'PUT /api/status-pages/019a0000-0000-7000-8000-0000000000c1',
    ])
    const requirementBody = calls[2].body as Record<string, unknown>
    expect(requirementBody).toEqual({ title: 'Login', tags: ['auth'], testIds: [T1] })
    expect(calls[3].body).toEqual({ name: 'Acme' })
    expect(calls[4].body).toEqual({ name: 'Web', monitorIds: [M1], position: 0 })
    expect(calls[5].body).toEqual({ status: 'published' })
    expect(JSON.stringify(calls)).not.toContain('subdomain')
  })

  it('fails before any write when a status page definition is invalid', async () => {
    local = [{ type: 'statusPage', name: 'Acme', definition: { name: 'Acme', components: [{ name: 'A', monitors: [] }, { name: 'A', monitors: [] }] } }]
    await expect(deployCommand.parseAsync(['node', 'deploy', '--force'])).rejects.toThrow('two components named')
    expect(post).not.toHaveBeenCalled()
  })
})
