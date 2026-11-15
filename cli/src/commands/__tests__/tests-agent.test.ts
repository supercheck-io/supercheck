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
    const localTypes = local.map((r) => (r.definition as { testType: string }).testType)
    expect(localTypes.sort()).toEqual(['agent', 'api', 'custom', 'database', 'playwright'])
    // Deploy sends the API type back, so nothing collapses to browser; same ids mean a second deploy updates, never duplicates.
    expect(localTypes.map((t) => normalizeTestTypeForApi(t)).sort()).toEqual(['agent', 'api', 'browser', 'custom', 'database'])
    const changes = reconcile(local, await fetchRemoteResources(client))
    expect(changes.filter((c) => c.type === 'test').map((c) => c.action)).toEqual(Array(5).fill('no-change'))
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
