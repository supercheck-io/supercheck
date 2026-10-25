import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ApiClient } from '../../api/client.js'
import { managedState } from '../managed.js'
import { buildLocalResources, fetchRemoteRequirements } from '../resources.js'
import type { SupercheckConfig } from '../../config/schema.js'

const TEST_A = '019a0000-0000-7000-8000-000000000001'
const TEST_B = '019a0000-0000-7000-8000-000000000002'
const MON = '019a0000-0000-7000-8000-0000000000a1'
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'supercheck-reqrefs-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('requirement and status page references', () => {
  it('resolves requirement `tests` and component `monitors` through managed state like job tests', () => {
    const client = new ApiClient({ baseUrl: 'https://example.com' })
    const state = managedState(client, { organization: { id: 'org' }, project: { id: 'project' } }, join(dir, 'supercheck.config.ts'))
    state.record('test', 'playwright/home.pw.ts', TEST_A)
    state.record('monitor', 'API', MON)

    const config = {
      schemaVersion: '1.0',
      project: { organization: 'org', project: 'project' },
      requirements: [{ title: 'Login', tags: ['Auth', 'auth', 'Core'], tests: ['_supercheck_/playwright/home.pw.ts', `slug.${TEST_B}.pw.ts`] }],
      statusPages: [{ name: 'Acme', components: [{ name: 'Web', monitors: ['API', MON] }] }],
    } as SupercheckConfig

    const built = buildLocalResources(config, dir)
    expect(built[0].definition.tags).toEqual(['Auth', 'Core'])
    const resolved = state.resolveTests(state.apply(built))
    expect(resolved.find((r) => r.type === 'requirement')?.definition.tests).toEqual([TEST_A, TEST_B])
    const page = resolved.find((r) => r.type === 'statusPage')
    expect((page?.definition.components as Array<{ monitors: string[]; position: number }>)[0]).toMatchObject({ monitors: [MON], position: 0 })
    expect(() => state.resolve('test', 'playwright/missing.pw.ts')).toThrow('Unresolved test reference')
  })

  it('pages through the requirement list and reads each requirement for its tags and linked tests', async () => {
    const all = Array.from({ length: 205 }, (_, i) => ({ id: `r${i}` }))
    const calls: string[] = []
    const client = {
      get: async (path: string, params?: Record<string, string>) => {
        calls.push(path)
        if (path === '/api/requirements') {
          const page = Number(params?.page)
          return { data: { data: all.slice((page - 1) * 200, page * 200), total: 205, page, pageSize: 200 } }
        }
        return { data: { requirement: { id: path.split('/').pop(), title: 't', tags: ['a'], testIds: [TEST_A] } } }
      },
    } as unknown as ApiClient
    const requirements = await fetchRemoteRequirements(client)
    expect(requirements).toHaveLength(205)
    expect(calls.filter((c) => c === '/api/requirements')).toHaveLength(2)
  })

  it('uses testIds from list items when present and reads details only for items without them', async () => {
    const calls: string[] = []
    const client = {
      get: async (path: string) => {
        calls.push(path)
        if (path === '/api/requirements') {
          return { data: { data: [
            { id: 'new', title: 'N', tags: [{ id: 't', name: 'Smoke' }], testIds: [TEST_A] },
            { id: 'old', title: 'O', tags: [{ id: 't', name: 'Smoke' }] },
          ], total: 2, page: 1, pageSize: 200 } }
        }
        return { data: { requirement: { id: 'old', title: 'O', tags: ['Smoke'], testIds: [TEST_B] } } }
      },
    } as unknown as ApiClient
    const requirements = await fetchRemoteRequirements(client)
    expect(requirements.map((r) => r.id).sort()).toEqual(['new', 'old'])
    expect(calls).toEqual(['/api/requirements', '/api/requirements/old'])
    expect(requirements.find((r) => r.id === 'old')?.testIds).toEqual([TEST_B])
  })
})
