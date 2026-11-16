import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supercheckConfigSchema } from '../../config/schema.js'
import { pullTests } from '../pull.js'
import { collectLocalTests } from '../tests.js'
import { buildLocalResources, fetchRemoteResources } from '../../utils/resources.js'
import { reconcile } from '../../utils/reconcile.js'
import { testRelativePath } from '../../utils/paths.js'
import { prepareBodyForApi } from '../deploy.js'
import { normalizeTestTypeForApi } from '../../utils/validation.js'
import type { ApiClient } from '../../api/client.js'

const ids = ['agent', 'api', 'database', 'custom', 'browser'].map((t, i) => [t, `019a0000-0000-7000-8000-00000000010${i}`] as const)
const script = "import { test } from '@playwright/test'\ntest('x', async () => {})\n"
const remoteTests = ids.map(([type, id]) => ({ id, title: `${type} test`, type, script, tags: [] }))
const page = (items: unknown[]) => ({ data: { data: items, pagination: { total: items.length, page: 1, limit: 200, totalPages: 1 } } })
const client = {
  get: async (path: string) => {
    if (path === '/api/tests?includeScript=true') return page(remoteTests)
    if (path === '/api/jobs' || path === '/api/monitors' || path === '/api/status-pages') return page([])
    if (path === '/api/requirements') return { data: { data: [], requirements: [], total: 0, page: 1, pageSize: 200 } }
    return { data: [] }
  },
} as unknown as ApiClient
const config = () => supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'org', project: 'project' }, tests: { playwright: {}, k6: {} } })

let dir: string
let cwdSpy: ReturnType<typeof jest.spyOn>
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'supercheck-agent-')))
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir)
})
afterEach(() => { cwdSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }) })

describe('@type header', () => {
  it('pulls non-browser types with a type line, diffs clean and deploys the same type', async () => {
    const summary = { tests: 0, monitors: 0, jobs: 0, variables: 0, tags: 0, notificationProviders: 0, statusPages: 0, requirements: 0, skipped: 0, files: [], backups: [], errors: [] as string[] }
    pullTests(remoteTests as never, dir, summary)
    expect(summary.errors).toEqual([])
    for (const [type, id] of ids) {
      const file = readFileSync(join(dir, testRelativePath(id, `${type} test`, 'playwright')), 'utf-8')
      expect(file.includes(`// @type ${type}`)).toBe(type !== 'browser')
    }

    const local = buildLocalResources(config(), dir)
    // Browser has no @type line, so its type stays unspecified locally.
    const localTypes = local.map((r) => (r.definition as { testType?: string }).testType)
    expect(localTypes.filter(Boolean).sort()).toEqual(['agent', 'api', 'custom', 'database'])
    expect(localTypes).toContain(undefined)
    // Deploy sends the API type back, so nothing collapses to browser; same ids mean a second deploy updates, never duplicates.
    expect(localTypes.filter(Boolean).map((t) => normalizeTestTypeForApi(t)).sort()).toEqual(['agent', 'api', 'custom', 'database'])
    const changes = reconcile(local, await fetchRemoteResources(client))
    expect(changes.filter((c) => c.type === 'test').map((c) => c.action)).toEqual(Array(5).fill('no-change'))
  })

  it('treats an unannotated file as type-unspecified: no diff against api/agent, no type on update, browser on create', async () => {
    mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
    for (const [type, id] of ids.slice(0, 2)) writeFileSync(join(dir, '_supercheck_', 'playwright', `old.${id}.pw.ts`), script.replace('x', `old ${type}`))
    const remote = await fetchRemoteResources({ get: client.get } as unknown as ApiClient)
    // Same script body as the remote, still unannotated.
    for (const [, id] of ids.slice(0, 2)) writeFileSync(join(dir, '_supercheck_', 'playwright', `old.${id}.pw.ts`), script)
    const local = buildLocalResources(config(), dir)
    for (const r of local) expect(r.definition).not.toHaveProperty('testType')
    const tests = reconcile(local, remote).filter((c) => c.type === 'test')
    expect(tests.map((c) => c.details ?? []).join('|')).not.toContain('testType')
    const body = prepareBodyForApi('test', { ...local[0].definition, title: 'renamed' }, 'update')
    expect(body).not.toHaveProperty('type')
    expect(prepareBodyForApi('test', { ...local[0].definition }, 'create').type).toBe('browser')
    // Explicit annotation still wins, including explicit browser against a non-browser remote.
    writeFileSync(join(dir, '_supercheck_', 'playwright', `old.${ids[1][1]}.pw.ts`), `// @type browser\n${script}`)
    const explicit = reconcile(buildLocalResources(config(), dir), remote).filter((c) => c.id === ids[1][1])
    expect(explicit[0].details?.join('|')).toContain('testType')
    expect(prepareBodyForApi('test', { testType: 'api' }, 'update').type).toBe('api')
  })

  it('refuses a local run of an agent test', () => {
    const file = join(dir, 'bot.pw.ts')
    writeFileSync(file, `// @type agent\n${script}`)
    expect(() => collectLocalTests(dir, {}, { file })).toThrow('executed remotely')
    writeFileSync(file, script)
    expect(collectLocalTests(dir, {}, { file })).toHaveLength(1)
    expect(() => collectLocalTests(dir, {}, { type: 'agent' })).toThrow('executed remotely')
  })

  it('rejects an unknown @type', () => {
    mkdirSync(join(dir, '_supercheck_', 'playwright'), { recursive: true })
    writeFileSync(join(dir, '_supercheck_', 'playwright', `bogus.${ids[0][1]}.pw.ts`), `// @type bogus\n${script}`)
    expect(() => buildLocalResources(config(), dir)).toThrow('@type must be')
  })
})
