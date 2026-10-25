import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import type { ApiClient } from '../../api/client.js'
import { ApiRequestError, CLIError, ExitCode } from '../errors.js'
import {
  applyStatusPage,
  compareComponents,
  normalizeLocalStatusPage,
  OLD_SERVER_STATUS_PAGE_MESSAGE,
  statusPageToDefinition,
  toApiSettings,
  validateStatusPageDefinition,
} from '../status-pages.js'
import { reconcile } from '../reconcile.js'
import { assertReferencesResolvable } from '../../commands/deploy.js'

const PAGE = '019a0000-0000-7000-8000-0000000000c1'
const M1 = '019a0000-0000-7000-8000-0000000000a1'
const M2 = '019a0000-0000-7000-8000-0000000000a2'

interface Call { method: string; path: string; body?: unknown }

function fakeClient(options: { remoteComponents?: unknown[]; failOn?: (call: Call) => Error | undefined } = {}) {
  const calls: Call[] = []
  const run = async (method: string, path: string, body?: unknown) => {
    const call = { method, path, body }
    calls.push(call)
    const failure = options.failOn?.(call)
    if (failure) throw failure
    if (method === 'POST' && path === '/api/status-pages') return { data: { statusPage: { id: PAGE } } }
    if (method === 'GET') return { data: { components: options.remoteComponents ?? [] } }
    return { data: {} }
  }
  const client = {
    get: (path: string) => run('GET', path),
    post: (path: string, body?: unknown) => run('POST', path, body),
    put: (path: string, body?: unknown) => run('PUT', path, body),
    delete: (path: string, body?: unknown) => run('DELETE', path, body),
  } as unknown as ApiClient
  return { client, calls }
}

const resolveMonitor = (ref: string) => ref

describe('applyStatusPage', () => {
  beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { jest.restoreAllMocks() })

  it('creates in order: POST, settings PUT, components, status PUT, and never sends subdomain', async () => {
    const { client, calls } = fakeClient()
    const created: string[] = []
    const definition = normalizeLocalStatusPage({
      name: 'Acme', headline: 'Hi', description: 'About', subdomain: 'ignored', timezone: 'Europe/Paris', status: 'published',
      branding: { fontColor: '#ABCDEF' }, notifications: { allowRssFeed: false },
      components: [{ name: 'Web', monitors: [M1] }, { name: 'API', description: 'api', monitors: [M2, M1] }],
    })
    await applyStatusPage(client, { action: 'create', name: 'Acme', definition, deleteMissing: false, resolveMonitor, onCreated: (id) => created.push(id) })

    expect(created).toEqual([PAGE])
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/status-pages',
      `PUT /api/status-pages/${PAGE}`,
      `POST /api/status-pages/${PAGE}/components`,
      `POST /api/status-pages/${PAGE}/components`,
      `PUT /api/status-pages/${PAGE}`,
    ])
    expect(calls[0].body).toEqual({ name: 'Acme', headline: 'Hi', pageDescription: 'About' })
    expect(calls[1].body).toEqual({ timezone: 'Europe/Paris', allowRssFeed: false, cssFontColor: '#abcdef' })
    expect(calls[2].body).toEqual({ name: 'Web', monitorIds: [M1], position: 0 })
    expect(calls[3].body).toEqual({ name: 'API', description: 'api', monitorIds: [M1, M2], position: 1 })
    expect(calls[4].body).toEqual({ status: 'published' })
    expect(JSON.stringify(calls)).not.toContain('subdomain')
  })

  it('does not send status for a draft create and skips the settings PUT when nothing else is set', async () => {
    const { client, calls } = fakeClient()
    await applyStatusPage(client, { action: 'create', name: 'Bare', definition: { name: 'Bare', status: 'draft' }, deleteMissing: false, resolveMonitor })
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/status-pages'])
  })

  it('syncs components on update: creates, updates, and deletes only with deleteMissing', async () => {
    const remoteComponents = [
      { id: 'c1', name: 'Web', description: null, position: 0, monitorIds: [M1] },
      { id: 'c2', name: 'Old', description: null, position: 1, monitorIds: [] },
    ]
    const definition = normalizeLocalStatusPage({
      name: 'Acme', components: [{ name: 'Web', monitors: [M1, M2] }, { name: 'New', monitors: [] }],
    })
    const remote = statusPageToDefinition({ id: PAGE, name: 'Acme', status: 'draft' })

    const keep = fakeClient({ remoteComponents })
    await applyStatusPage(keep.client, { action: 'update', id: PAGE, name: 'Acme', definition, remote, deleteMissing: false, resolveMonitor })
    expect(keep.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET /api/status-pages/${PAGE}/components`,
      `PUT /api/status-pages/${PAGE}/components/c1`,
      `POST /api/status-pages/${PAGE}/components`,
    ])
    expect(keep.calls[1].body).toEqual({ monitorIds: [M1, M2] })

    const purge = fakeClient({ remoteComponents })
    await applyStatusPage(purge.client, { action: 'update', id: PAGE, name: 'Acme', definition, remote, deleteMissing: true, resolveMonitor })
    expect(purge.calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/status-pages/${PAGE}/components/c2` })
  })

  it('matches components by id before name', async () => {
    const remoteComponents = [{ id: 'c1', name: 'Renamed remotely', position: 0, monitorIds: [] }]
    const definition = normalizeLocalStatusPage({ name: 'Acme', components: [{ id: 'c1', name: 'Web', monitors: [] }] })
    const { client, calls } = fakeClient({ remoteComponents })
    await applyStatusPage(client, { action: 'update', id: PAGE, name: 'Acme', definition, remote: { name: 'Acme' }, deleteMissing: false, resolveMonitor })
    expect(calls[1]).toMatchObject({ method: 'PUT', path: `/api/status-pages/${PAGE}/components/c1`, body: { name: 'Web' } })
  })

  it('sends only changed settings on update', async () => {
    const { client, calls } = fakeClient()
    const remote = statusPageToDefinition({ id: PAGE, name: 'Acme', headline: 'Old', status: 'published', timezone: 'UTC' })
    await applyStatusPage(client, { action: 'update', id: PAGE, name: 'Acme', definition: { name: 'Acme', headline: 'New', timezone: 'UTC', status: 'published' }, remote, deleteMissing: false, resolveMonitor })
    expect(calls).toEqual([{ method: 'PUT', path: `/api/status-pages/${PAGE}`, body: { headline: 'New' } }])
  })

  it('resolves monitor references before the first write', async () => {
    const { client, calls } = fakeClient()
    const definition = normalizeLocalStatusPage({ name: 'Acme', components: [{ name: 'Web', monitors: ['missing'] }] })
    await expect(applyStatusPage(client, {
      action: 'create', name: 'Acme', definition, deleteMissing: false,
      resolveMonitor: () => { throw new Error('Unresolved monitor reference "missing"') },
    })).rejects.toThrow('Unresolved monitor')
    expect(calls).toEqual([])
  })

  it.each([404, 405])('maps %i on the first call to the upgrade message', async (status) => {
    const { client, calls } = fakeClient({ failOn: () => new ApiRequestError('nope', status) })
    await expect(applyStatusPage(client, { action: 'create', name: 'Acme', definition: { name: 'Acme' }, deleteMissing: false, resolveMonitor }))
      .rejects.toThrow(OLD_SERVER_STATUS_PAGE_MESSAGE)
    expect(calls).toHaveLength(1)
  })

  it('maps an old server on update where the first call is the components read', async () => {
    const { client } = fakeClient({ failOn: (call) => (call.method === 'GET' ? new ApiRequestError('nope', 404) : undefined) })
    await expect(applyStatusPage(client, { action: 'update', id: PAGE, name: 'Acme', definition: { name: 'Acme', components: [] }, remote: { name: 'Acme' }, deleteMissing: false, resolveMonitor }))
      .rejects.toThrow(OLD_SERVER_STATUS_PAGE_MESSAGE)
  })

  it('reports the created id when a later step fails', async () => {
    const { client } = fakeClient({ failOn: (call) => (call.path.endsWith('/components') ? new ApiRequestError('boom', 500) : undefined) })
    const definition = normalizeLocalStatusPage({ name: 'Acme', components: [{ name: 'Web' }] })
    const error = await applyStatusPage(client, { action: 'create', name: 'Acme', definition, deleteMissing: false, resolveMonitor }).catch((e) => e)
    expect(error.message).toContain(`created (${PAGE})`)
    expect(error.details).toEqual({ id: PAGE })
  })
})

describe('status page mapping', () => {
  it('toApiSettings never includes subdomain or status', () => {
    expect(toApiSettings({ name: 'A', subdomain: 'x', status: 'published', description: 'd' })).toEqual({ name: 'A', pageDescription: 'd' })
  })

  it('compareComponents is order-insensitive and reports adds, changes and extras', () => {
    const local = normalizeLocalStatusPage({ components: [{ name: 'B', monitors: [M2, M1], position: 1 }, { name: 'A', monitors: [], position: 0 }] }).components
    const remote = statusPageToDefinition({ id: 'x', name: 'n' }, [
      { id: 'r1', name: 'A', position: 0, monitorIds: [] },
      { id: 'r2', name: 'B', position: 1, monitorIds: [M1, M2] },
    ]).components
    expect(compareComponents(local, remote)).toEqual([])
    expect(compareComponents([...(local as unknown[]), { name: 'C', monitors: [], position: 2 }], remote)).toEqual(['components: + "C"'])
    expect(compareComponents([], remote)).toHaveLength(2)
  })

  it('validates duplicate names and publishing without components', () => {
    expect(() => validateStatusPageDefinition({ components: [{ name: 'A' }, { name: 'A' }] }, 'P')).toThrow('two components named')
    expect(() => validateStatusPageDefinition({ status: 'published', components: [] }, 'P')).toThrow('at least one component')
    expect(() => validateStatusPageDefinition({ status: 'published' }, 'P')).not.toThrow()
  })
})

describe('assertReferencesResolvable', () => {
  const resolve = (type: string, ref: string) => {
    if (ref === 'known') return 'id'
    throw new CLIError(`Unresolved ${type} reference "${ref}".`, ExitCode.ConfigError)
  }
  const change = (type: string, name: string, definition: Record<string, unknown>, action = 'create') =>
    ({ action, type, name, local: { type, name, definition } }) as never

  it('accepts references to known resources or resources created in the same deploy', () => {
    expect(() => assertReferencesResolvable([
      change('test', 'playwright/new.pw.ts', {}),
      change('monitor', 'API', {}),
      change('requirement', 'R', { tests: ['known', '_supercheck_/playwright/new.pw.ts'] }),
      change('statusPage', 'P', { components: [{ name: 'c', monitors: ['API', 'known'] }] }),
    ], { resolve })).not.toThrow()
  })

  it('rejects unresolved requirement tests and status page monitors before any write', () => {
    expect(() => assertReferencesResolvable([change('requirement', 'R', { tests: ['nope'] })], { resolve })).toThrow('requirement/R')
    expect(() => assertReferencesResolvable([change('statusPage', 'P', { components: [{ name: 'c', monitors: ['nope'] }] })], { resolve })).toThrow('statusPage/P')
  })
})

describe('stable diffs', () => {
  const remoteComponents = [
    { id: 'c1', name: 'Web', description: 'Public site', position: 0, monitorIds: [] },
    { id: 'c2', name: 'Extra', description: null, position: 1, monitorIds: [] },
  ]
  const remote = statusPageToDefinition({ id: PAGE, name: 'Acme', status: 'draft' }, remoteComponents)
  const local = (components: unknown[]) => ({ id: PAGE, type: 'statusPage' as const, name: 'Acme', definition: normalizeLocalStatusPage({ name: 'Acme', components }) })
  const remoteResource = { id: PAGE, type: 'statusPage' as const, name: 'Acme', raw: remote }

  it('an omitted component description is left alone: no diff, nothing sent', async () => {
    expect(compareComponents(local([{ name: 'Web' }]).definition.components, remote.components)).toEqual(['components: - "Extra"'])
    const { client, calls } = fakeClient({ remoteComponents })
    await applyStatusPage(client, { action: 'update', id: PAGE, name: 'Acme', definition: local([{ name: 'Web' }, { name: 'Extra', monitors: [M1] }]).definition, remote: { name: 'Acme' }, deleteMissing: false, resolveMonitor })
    expect(JSON.stringify(calls.map((c) => c.body))).not.toContain('description')
  })

  it('an explicit empty description clears the remote one', async () => {
    const { client, calls } = fakeClient({ remoteComponents })
    await applyStatusPage(client, { action: 'update', id: PAGE, name: 'Acme', definition: local([{ name: 'Web', description: '' }]).definition, remote: { name: 'Acme' }, deleteMissing: false, resolveMonitor })
    expect(calls.find((c) => c.method === 'PUT' && c.path.endsWith('/c1'))?.body).toEqual({ description: '' })
  })

  it('remote-only components are a note without --delete and a change with it', () => {
    const [plain] = reconcile([local([{ name: 'Web' }, ])], [remoteResource])
    expect(plain.action).toBe('no-change')
    expect(plain.notes?.[0]).toContain('Extra')

    const [purge] = reconcile([local([{ name: 'Web' }])], [remoteResource], { deleteMissing: true })
    expect(purge.action).toBe('update')
    expect(purge.details).toEqual(['components: - "Extra"'])
  })
})
