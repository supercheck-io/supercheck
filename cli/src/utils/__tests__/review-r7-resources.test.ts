import { describe, it, expect } from '@jest/globals'
import { buildLocalResources } from '../resources.js'
import { reconcile } from '../reconcile.js'
import { supercheckConfigSchema } from '../../config/schema.js'

const base = { schemaVersion: '1.0' as const, project: { organization: 'org', project: 'project' } }
const jobId = '11111111-1111-4111-8111-111111111111'

describe('alertConfig diff and deploy payload', () => {
  const diff = (local: Record<string, unknown>, remote: Record<string, unknown> | undefined, type: 'job' | 'monitor' = 'job') => {
    const definition = type === 'job'
      ? { name: 'J', tests: [jobId], alertConfig: local }
      : { name: 'M', type: 'http_request', target: 'https://example.com', alertConfig: local }
    const [res] = buildLocalResources({ ...base, ...(type === 'job' ? { jobs: [definition as never] } : { monitors: [definition as never] }) }, process.cwd())
    const raw = { id: 'r', name: definition.name, ...(type === 'job' ? { tests: [jobId] } : { type: 'http_request', target: 'https://example.com' }), ...(remote ? { alertConfig: remote } : {}) }
    return { res, changes: reconcile([{ ...res, id: 'r' }], [{ id: 'r', type, name: definition.name, raw }], {}) }
  }

  it('treats a local config without alertOnFailure as the server default (true)', () => {
    expect(diff({ enabled: true, notificationProviders: ['x'] }, { enabled: true, notificationProviders: ['x'], alertOnFailure: true }).changes.filter((c) => c.action === 'update')).toEqual([])
  })

  it('treats explicit false flags as already matching a stripped remote', () => {
    expect(diff({ enabled: true, alertOnFailure: false, failureThreshold: 1 }, { enabled: true }).changes.filter((c) => c.action === 'update')).toEqual([])
  })

  it('still reports a real difference, for monitors too', () => {
    expect(diff({ enabled: true }, { enabled: true }, 'monitor').changes.filter((c) => c.action === 'update')).toHaveLength(1)
  })

  it('keeps explicit false in the deploy payload', () => {
    expect(diff({ enabled: true, alertOnFailure: false }, undefined).res.definition.alertConfig).toEqual({ enabled: true, alertOnFailure: false })
  })
})

describe('config schema rejects ignored fields', () => {
  it.each(['monitors', 'statusPages'])('rejects a glob string for %s', (key) => {
    const result = supercheckConfigSchema.safeParse({ ...base, [key]: './x/**' })
    expect(result.success).toBe(false)
  })

  it('rejects job status', () => {
    const result = supercheckConfigSchema.safeParse({ ...base, jobs: [{ name: 'J', tests: [jobId], status: 'paused' }] })
    expect(result.success).toBe(false)
  })
})
