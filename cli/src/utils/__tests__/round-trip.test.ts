import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient } from '../../api/client.js'
import { supercheckConfigSchema } from '../../config/schema.js'
import {
  buildMonitorDefinitions,
  buildRequirementDefinitions,
  buildStatusPageDefinitions,
  pullTests,
} from '../../commands/pull.js'
import { buildLocalResources, fetchRemoteResources } from '../resources.js'
import { reconcile } from '../reconcile.js'
import { testRelativePath } from '../paths.js'
import { resolveTagIds } from '../tag-assignment.js'
import { managedState } from '../managed.js'

const TEST_ID = '019a0000-0000-7000-8000-000000000001'
const TEST_ID_2 = '019a0000-0000-7000-8000-000000000002'
const MONITOR_ID = '019a0000-0000-7000-8000-0000000000a1'
const MONITOR_ID_2 = '019a0000-0000-7000-8000-0000000000a2'
const REQ_ID = '019a0000-0000-7000-8000-0000000000b1'
const PAGE_ID = '019a0000-0000-7000-8000-0000000000c1'
const COMP_ID = '019a0000-0000-7000-8000-0000000000d1'
const COMP_ID_2 = '019a0000-0000-7000-8000-0000000000d2'

const remoteTests = [
  { id: TEST_ID, title: 'Homepage', type: 'browser', priority: 'high', script: "import { test } from '@playwright/test'\ntest('x', async () => {})\n", tags: [{ id: 't1', name: 'smoke' }, { id: 't2', name: 'checkout' }] },
  { id: TEST_ID_2, title: 'Login', type: 'browser', priority: 'low', script: "import { test } from '@playwright/test'\ntest('y', async () => {})\n", tags: [] },
]
const remoteMonitors = [
  {
    id: MONITOR_ID, name: 'API health', type: 'http_request', target: 'https://example.com/health', frequencyMinutes: 5, enabled: true,
    config: { method: 'GET', expectedStatusCodes: '200-299' }, tags: [{ id: 't1', name: 'smoke' }, { id: 't3', name: 'api' }],
  },
  { id: MONITOR_ID_2, name: 'Site', type: 'website', target: 'https://example.com', frequencyMinutes: 10, enabled: true, tags: [] },
]
const requirementDto = {
  id: REQ_ID, title: 'Users can log in', description: 'Login works', priority: 'high', tags: ['auth', 'core'],
  externalId: 'JIRA-1', externalUrl: 'https://jira.example.com/JIRA-1', testIds: [TEST_ID_2, TEST_ID],
  coverage: { status: 'covered', linkedTestCount: 2, passedTestCount: 2, failedTestCount: 0, lastEvaluatedAt: null },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const statusPageRow = {
  id: PAGE_ID, name: 'Acme Status', subdomain: 'abc123', status: 'published', pageDescription: 'All systems', headline: 'Acme', supportUrl: 'https://acme.example.com/help',
  allowPageSubscribers: true, allowIncidentSubscribers: true, allowEmailSubscribers: true, allowWebhookSubscribers: false, allowSlackSubscribers: true, allowRssFeed: true,
  timezone: 'UTC', language: 'en', customDomain: 'status.acme.example.com',
  cssBodyBackgroundColor: '#FFFFFF', cssFontColor: '#333333', cssLightFontColor: '#666666', cssGreens: '#2ecc71', cssYellows: '#f1c40f', cssOranges: '#e67e22',
  cssBlues: '#3498db', cssReds: '#e74c3c', cssBorderColor: '#ecf0f1', cssGraphColor: '#3498db', cssLinkColor: '#3498db', cssNoData: '#bdc3c7',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
}
const statusPageComponents = [
  { id: COMP_ID_2, name: 'API', description: null, position: 1, monitorIds: [MONITOR_ID_2, MONITOR_ID] },
  { id: COMP_ID, name: 'Website', description: 'Public site', position: 0, monitorIds: [MONITOR_ID_2] },
]

const page = (items: unknown[]) => ({ data: { data: items, pagination: { total: items.length, page: 1, limit: 200, totalPages: 1 } } })

function fakeClient(): ApiClient {
  return {
    getBaseUrl: () => 'https://example.com',
    get: async (path: string) => {
      switch (path) {
        case '/api/jobs': return page([])
        case '/api/tests?includeScript=true': return page(remoteTests)
        case '/api/monitors': return page(remoteMonitors)
        case '/api/status-pages': return page([statusPageRow])
        case `/api/status-pages/${PAGE_ID}`: return { data: { statusPage: statusPageRow, components: statusPageComponents, monitors: [] } }
        case '/api/requirements': return { data: { data: [{ id: REQ_ID, title: requirementDto.title, tags: [{ id: 'x', name: 'auth' }] }], requirements: [], total: 1, page: 1, pageSize: 200 } }
        case `/api/requirements/${REQ_ID}`: return { data: { requirement: requirementDto } }
        case '/api/variables': case '/api/tags': case '/api/notification-providers': return { data: [] }
        default: throw new Error(`Unexpected path ${path}`)
      }
    },
  } as unknown as ApiClient
}

let dir: string
let cwdSpy: ReturnType<typeof jest.spyOn>
let errorSpy: ReturnType<typeof jest.spyOn>
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'supercheck-roundtrip-')))
  // pull writes are confined to process.cwd()
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { cwdSpy.mockRestore(); errorSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }) })

describe('pull -> buildLocalResources -> reconcile', () => {
  it('reports zero changes for requirements, status pages, tests (priority/tags) and monitors (tags)', async () => {
    const summary = { tests: 0, monitors: 0, jobs: 0, variables: 0, tags: 0, notificationProviders: 0, statusPages: 0, requirements: 0, skipped: 0, files: [], backups: [], errors: [] as string[] }
    pullTests(remoteTests as never, dir, summary)
    expect(summary.errors).toEqual([])

    const testMap = new Map<string, string>(remoteTests.map((t) => [t.id, testRelativePath(t.id, t.title, 'playwright')]))
    const config = supercheckConfigSchema.parse({
      schemaVersion: '1.0',
      project: { organization: 'org', project: 'project' },
      tests: { playwright: {}, k6: {} },
      monitors: buildMonitorDefinitions(remoteMonitors as never),
      requirements: buildRequirementDefinitions([requirementDto] as never, testMap),
      statusPages: buildStatusPageDefinitions([{ ...statusPageRow, components: statusPageComponents }] as never),
    })

    const client = fakeClient()
    const state = managedState(client, { organization: { id: 'org' }, project: { id: 'project' } }, join(dir, 'supercheck.config.ts'))
    const local = state.resolveTests(state.apply(buildLocalResources(config, dir)))
    expect(local.map((r) => r.type).sort()).toEqual(['monitor', 'monitor', 'requirement', 'statusPage', 'test', 'test'])

    const remote = await fetchRemoteResources(client)
    const changes = reconcile(local, remote)
    expect(changes.filter((c) => c.action !== 'no-change').map((c) => ({ type: c.type, name: c.name, details: c.details }))).toEqual([])
    expect(changes.filter((c) => c.action === 'no-change')).toHaveLength(6)
  })

  it('detects real drift in requirement links, tags and status page components', async () => {
    const config = supercheckConfigSchema.parse({
      schemaVersion: '1.0',
      project: { organization: 'org', project: 'project' },
      requirements: [{ id: REQ_ID, title: 'Users can log in', tags: ['auth'], tests: [TEST_ID] }],
      statusPages: [{
        id: PAGE_ID, name: 'Acme Status', branding: { fontColor: '#111111' }, notifications: { allowRssFeed: false },
        components: [{ name: 'Website', description: 'Public site', monitors: [MONITOR_ID] }],
      }],
    })
    const client = fakeClient()
    const state = managedState(client, { organization: { id: 'org' }, project: { id: 'project' } }, join(dir, 'supercheck.config.ts'))
    const local = state.resolveTests(state.apply(buildLocalResources(config, dir)))
    const changes = reconcile(local, await fetchRemoteResources(client), { deleteMissing: true }).filter((c) => c.action === 'update')
    const requirement = changes.find((c) => c.type === 'requirement')
    expect(requirement?.details?.join('\n')).toContain('tests')
    const statusPage = changes.find((c) => c.type === 'statusPage')
    const text = statusPage?.details?.join('\n') ?? ''
    expect(text).toContain('branding')
    expect(text).toContain('notifications')
    expect(text).toContain('components: ~ "Website" (monitors)')
    expect(text).toContain('components: - "API"')
  })
})

describe('tag casing', () => {
  it('compares requirement, test and monitor tags case-insensitively', () => {
    const resource = (type: 'requirement' | 'test' | 'monitor', local: string[], remote: string[]) =>
      reconcile([{ id: 'x', type, name: 'n', definition: { tags: local } }], [{ id: 'x', type, name: 'n', raw: { tags: remote } }])[0].action
    for (const type of ['requirement', 'test', 'monitor'] as const) {
      expect(resource(type, ['smoke', 'API'], ['Smoke', 'api'])).toBe('no-change')
      expect(resource(type, ['smoke'], ['Smoke', 'extra'])).toBe('update')
    }
  })

  it('keeps the spelling written in config for requirement tags', () => {
    const config = supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, requirements: [{ title: 'R', tags: ['smoke', 'Smoke', 'Core'] }] })
    expect(buildLocalResources(config, dir)[0].definition.tags).toEqual(['Core', 'smoke'])
  })

  it('resolves tag references case-insensitively when there is no exact match', async () => {
    const client = { get: async () => ({ data: [{ id: 'id-1', name: 'Smoke' }, { id: 'id-2', name: 'smoke2' }] }) } as unknown as ApiClient
    await expect(resolveTagIds(client, ['smoke', 'smoke2'])).resolves.toEqual(['id-1', 'id-2'])
    await expect(resolveTagIds(client, ['nope'])).rejects.toThrow('does not exist')
  })
})
