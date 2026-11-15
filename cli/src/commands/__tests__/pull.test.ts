import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../../api/client.js'
import { supercheckConfigSchema } from '../../config/schema.js'
import { buildMonitorDefinitions } from '../pull.js'
import { buildLocalResources, fetchRemoteResources } from '../../utils/resources.js'
import { reconcile } from '../../utils/reconcile.js'
import { managedState } from '../../utils/managed.js'

const MONITOR_ID = '019a0000-0000-7000-8000-0000000000a1'
const TOKEN = `hb_${'c3'.repeat(16)}`
const PING_URL = `https://app.example.com/api/heartbeat/${TOKEN}`

/** A heartbeat monitor as GET /api/monitors returns it, plus fields that must never reach a config file. */
const remoteHeartbeat = (warnings: Record<string, boolean>, description?: string) => ({
  id: MONITOR_ID, name: 'Nightly backup', type: 'heartbeat', target: '', frequencyMinutes: 1440, enabled: true, status: 'up',
  ...(description ? { description } : {}),
  config: { heartbeat: { graceMinutes: 60 } },
  alertConfig: { enabled: true, alertOnFailure: true, alertOnRecovery: true, failureThreshold: 1, recoveryThreshold: 1, incidentEnabled: true, incidentSeverity: 'sev2', autoResolveIncident: true, notificationProviders: [], warnings },
  heartbeat: { state: 'up', lastPingAt: '2026-11-14T10:00:00.000Z', lastPingKind: 'ping', lastStartAt: null, nextExpectedAt: '2026-11-15T11:00:00.000Z', graceMinutes: 60, pingUrl: PING_URL },
  heartbeatTokenHash: 'f'.repeat(64), heartbeatTokenEncrypted: 'ciphertext', heartbeatState: { pingSeq: 3 },
  tags: [],
})

let dir: string
let cwdSpy: ReturnType<typeof jest.spyOn>
let errorSpy: ReturnType<typeof jest.spyOn>
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'supercheck-heartbeat-pull-')))
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(dir)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => { cwdSpy.mockRestore(); errorSpy.mockRestore(); rmSync(dir, { recursive: true, force: true }) })

describe('pull heartbeat monitors', () => {
  it('writes interval, grace and enabled warnings, and no token, ping URL or runtime state', () => {
    // A ping URL pasted into a text field is masked too.
    const [def] = buildMonitorDefinitions([remoteHeartbeat({ heartbeat_late: true }, `Pings ${PING_URL}`)] as never)
    expect(def).toMatchObject({ id: MONITOR_ID, type: 'heartbeat', frequencyMinutes: 1440, config: { heartbeat: { graceMinutes: 60 } } })
    expect(def.alertConfig).toMatchObject({ warnings: { heartbeat_late: true } })
    expect(def).not.toHaveProperty('target')
    for (const key of ['heartbeat', 'heartbeatTokenHash', 'heartbeatTokenEncrypted', 'heartbeatState', 'status']) expect(def).not.toHaveProperty(key)
    const text = JSON.stringify(def)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('pingUrl')
    expect(text).not.toContain('lastPingAt')
    expect(() => supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'o', project: 'p' }, monitors: [def] })).not.toThrow()
  })

  it('drops warnings that are off (the default)', () => {
    const [def] = buildMonitorDefinitions([remoteHeartbeat({ heartbeat_late: false })] as never)
    expect(def.alertConfig).not.toHaveProperty('warnings')
  })
})

describe('pull -> diff round trip for heartbeat monitors', () => {
  async function diff(remote: ReturnType<typeof remoteHeartbeat>, local: Record<string, unknown>) {
    const client = {
      getBaseUrl: () => 'https://example.com',
      get: async (path: string) => {
        if (path === '/api/monitors') return { data: { data: [remote], pagination: { total: 1, page: 1, limit: 200, totalPages: 1 } } }
        if (['/api/jobs', '/api/tests?includeScript=true', '/api/status-pages'].includes(path)) return { data: { data: [], pagination: { total: 0, page: 1, limit: 200, totalPages: 1 } } }
        return { data: [] }
      },
    } as unknown as ApiClient
    const config = supercheckConfigSchema.parse({ schemaVersion: '1.0', project: { organization: 'org', project: 'project' }, monitors: [local] })
    const state = managedState(client, { organization: { id: 'org' }, project: { id: 'project' } }, join(dir, 'supercheck.config.ts'))
    return reconcile(state.resolveTests(state.apply(buildLocalResources(config, dir))), await fetchRemoteResources(client)).filter((c) => c.type === 'monitor')
  }

  it.each([{ heartbeat_late: false }, { heartbeat_late: true }])('a pulled config has no changes (warnings %p)', async (warnings) => {
    const remote = remoteHeartbeat(warnings)
    const [local] = buildMonitorDefinitions([remote] as never)
    const changes = await diff(remote, local)
    expect(changes.map((c) => ({ action: c.action, details: c.details ?? [] }))).toEqual([{ action: 'no-change', details: [] }])
  })

  it('shows a warning toggle that differs', async () => {
    const remote = remoteHeartbeat({ heartbeat_late: false })
    const [local] = buildMonitorDefinitions([remoteHeartbeat({ heartbeat_late: true })] as never)
    const [change] = await diff(remote, local)
    expect(change.action).toBe('update')
    expect(change.details?.join('\n')).toContain('heartbeat_late')
  })
})
