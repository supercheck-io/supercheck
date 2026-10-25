/**
 * Reconcile Utility Unit Tests
 *
 * Tests for id-based reconciliation between local config resources and the
 * remote API, plus change-plan formatting:
 * - create / update / delete / no-change detection
 * - stable field diffing (key order, metadata, secrets, masked config)
 * - change-plan rendering through the logger
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import { reconcile, formatChangePlan } from '../reconcile.js'
import type { LocalResource, RemoteResource, ResourceChange } from '../reconcile.js'
import { logger } from '../logger.js'

function local(overrides: Partial<LocalResource> = {}): LocalResource {
  return {
    type: 'test',
    name: 'Login flow',
    definition: { name: 'Login flow', url: 'https://example.com' },
    ...overrides,
  }
}

function remote(overrides: Partial<RemoteResource> = {}): RemoteResource {
  return {
    id: 'id-1',
    type: 'test',
    name: 'Login flow',
    raw: { name: 'Login flow', url: 'https://example.com' },
    ...overrides,
  }
}

describe('reconcile', () => {
  it('treats local resources without an id as creates', () => {
    const changes = reconcile([local()], [])

    expect(changes).toEqual([
      expect.objectContaining({ action: 'create', type: 'test', name: 'Login flow' }),
    ])
    expect(changes[0].local).toBeDefined()
    expect(changes[0].remote).toBeUndefined()
  })

  it('treats a known id missing from remote as a create', () => {
    const changes = reconcile([local({ id: 'id-9' })], [])

    expect(changes).toEqual([
      expect.objectContaining({ action: 'create', id: 'id-9' }),
    ])
  })

  it('reports no-change when the definition matches the remote state', () => {
    const changes = reconcile([local({ id: 'id-1' })], [remote()])

    expect(changes).toEqual([
      expect.objectContaining({ action: 'no-change', id: 'id-1' }),
    ])
  })

  it('ignores remote-only fields when diffing', () => {
    const changes = reconcile(
      [local({ id: 'id-1' })],
      [remote({ raw: { name: 'Login flow', url: 'https://example.com', serverOnly: true } })],
    )

    expect(changes[0].action).toBe('no-change')
  })

  it('reports an update with human-readable diffs when fields differ', () => {
    const changes = reconcile(
      [local({ id: 'id-1', definition: { name: 'Login flow', url: 'https://new.example.com' } })],
      [remote()],
    )

    expect(changes[0].action).toBe('update')
    expect(changes[0].details).toEqual([
      'url: "https://example.com" -> "https://new.example.com"',
    ])
    expect(changes[0].remote).toBeDefined()
  })

  it('does not produce false diffs from key insertion order', () => {
    const changes = reconcile(
      [
        local({
          id: 'id-1',
          definition: { config: { beta: 2, alpha: 1 } },
        }),
      ],
      [remote({ raw: { config: { alpha: 1, beta: 2 } } })],
    )

    expect(changes[0].action).toBe('no-change')
  })

  it('detects arrays as changed when values differ', () => {
    const changes = reconcile(
      [local({ id: 'id-1', definition: { tags: ['a', 'b'] } })],
      [remote({ raw: { tags: ['a'] } })],
    )

    expect(changes[0].action).toBe('update')
    expect(changes[0].details?.[0]).toContain('tags')
  })

  it.each([
    'id',
    'createdAt',
    'updatedAt',
    'projectId',
    'organizationId',
    'createdByUserId',
    '__maskedFields',
  ])('ignores metadata field %s when diffing', (field) => {
    const changes = reconcile(
      [local({ id: 'id-1', definition: { name: 'Login flow', [field]: 'local' } })],
      [remote({ raw: { name: 'Login flow', [field]: 'remote' } })],
    )

    expect(changes[0].action).toBe('no-change')
  })

  it('skips secret values in diffs to avoid phantom changes', () => {
    const localSecret = local({
      id: 'id-1',
      type: 'variable',
      definition: { name: 'API_KEY', value: 'super-secret', isSecret: true },
    })
    const remoteVariable = remote({
      type: 'variable',
      raw: { name: 'API_KEY', value: '', isSecret: true },
    })

    const changes = reconcile([localSecret], [remoteVariable])

    expect(changes[0].action).toBe('no-change')
  })

  it('still diffs non-secret variable values', () => {
    const localVariable = local({
      id: 'id-1',
      type: 'variable',
      definition: { name: 'BASE_URL', value: 'https://new.example.com' },
    })
    const remoteVariable = remote({
      type: 'variable',
      raw: { name: 'BASE_URL', value: 'https://old.example.com' },
    })

    const changes = reconcile([localVariable], [remoteVariable])

    expect(changes[0].action).toBe('update')
    expect(changes[0].details?.[0]).toContain('value')
  })

  it('ignores masked config fields absent from the local definition', () => {
    const localMonitor = local({
      id: 'id-1',
      type: 'monitor',
      definition: { name: 'Health', config: { url: 'https://example.com' } },
    })
    const remoteMonitor = remote({
      type: 'monitor',
      raw: {
        name: 'Health',
        config: { url: 'https://example.com', apiKey: '[masked]' },
        __maskedFields: ['apiKey'],
      },
    })

    const changes = reconcile([localMonitor], [remoteMonitor])

    expect(changes[0].action).toBe('no-change')
  })

  it('reports an update when the local config provides a masked field, without leaking the secret', () => {
    const localMonitor = local({
      id: 'id-1',
      type: 'monitor',
      definition: { name: 'Health', config: { url: 'https://new.example.com', apiKey: 'local-secret' } },
    })
    const remoteMonitor = remote({
      type: 'monitor',
      raw: {
        name: 'Health',
        config: { url: 'https://old.example.com', apiKey: '[masked]' },
        __maskedFields: ['apiKey'],
      },
    })

    const changes = reconcile([localMonitor], [remoteMonitor])
    const details = changes[0].details?.join('\n') ?? ''

    expect(changes[0].action).toBe('update')
    expect(details).toContain('url')
    expect(details).toContain('[local secret provided]')
    expect(details).toContain('[remote secret masked]')
    expect(details).not.toContain('local-secret')
  })

  it('treats a remote resource with no local counterpart as a delete', () => {
    const changes = reconcile([], [remote()])

    expect(changes).toEqual([
      expect.objectContaining({ action: 'delete', id: 'id-1', type: 'test' }),
    ])
  })

  it('does not match resources of different types with the same id', () => {
    const changes = reconcile(
      [local({ id: 'shared-id', type: 'test' })],
      [remote({ id: 'shared-id', type: 'monitor' })],
    )

    expect(changes.map((c) => c.action).sort()).toEqual(['create', 'delete'])
  })

  it('handles a mixed plan across resource types', () => {
    const localResources: LocalResource[] = [
      local({ id: 'test-1' }), // no-change
      local({ id: 'test-2', definition: { name: 'Login flow', url: 'https://changed.example.com' } }), // update
      local({ type: 'monitor', name: 'New monitor' }), // create
    ]
    const remoteResources: RemoteResource[] = [
      remote({ id: 'test-1' }),
      remote({ id: 'test-2' }),
      remote({ id: 'monitor-1', type: 'monitor', name: 'Old monitor', raw: { name: 'Old monitor' } }), // delete
    ]

    const changes = reconcile(localResources, remoteResources)
    const byAction = changes.reduce<Record<string, number>>((acc, change) => {
      acc[change.action] = (acc[change.action] ?? 0) + 1
      return acc
    }, {})

    expect(byAction).toEqual({
      'no-change': 1,
      update: 1,
      create: 1,
      delete: 1,
    })
  })

  it('returns an empty plan when there is nothing on either side', () => {
    expect(reconcile([], [])).toEqual([])
  })
})

describe('formatChangePlan', () => {
  let infoSpy: jest.SpiedFunction<typeof logger.info>
  let successSpy: jest.SpiedFunction<typeof logger.success>
  let headerSpy: jest.SpiedFunction<typeof logger.header>

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {})
    successSpy = jest.spyOn(logger, 'success').mockImplementation(() => {})
    headerSpy = jest.spyOn(logger, 'header').mockImplementation(() => {})
    jest.spyOn(logger, 'newline').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  function outputLines(): string[] {
    return infoSpy.mock.calls.map((call) => String(call[0]))
  }

  it('prints a sync message when there are no changes', () => {
    formatChangePlan([])

    expect(headerSpy).toHaveBeenCalledWith('Change Plan')
    expect(successSpy).toHaveBeenCalledWith('No changes detected. Everything is in sync.')
  })

  it('prints counts and names for each action', () => {
    const changes: ResourceChange[] = [
      { action: 'create', type: 'test', name: 'New test' },
      { action: 'update', type: 'monitor', id: 'mon-1', name: 'Monitor', details: ['url: "a" -> "b"'] },
      { action: 'delete', type: 'job', id: 'job-1', name: 'Old job' },
      { action: 'no-change', type: 'tag', id: 'tag-1', name: 'Stable tag' },
    ]

    formatChangePlan(changes)

    const lines = outputLines()
    expect(lines.some((l) => l.includes('1 to create'))).toBe(true)
    expect(lines.some((l) => l.includes('test/New test'))).toBe(true)
    expect(lines.some((l) => l.includes('1 to update'))).toBe(true)
    expect(lines.some((l) => l.includes('monitor/Monitor (mon-1)'))).toBe(true)
    expect(lines.some((l) => l.includes('url: "a" -> "b"'))).toBe(true)
    expect(lines.some((l) => l.includes('1 to delete'))).toBe(true)
    expect(lines.some((l) => l.includes('job/Old job (job-1)'))).toBe(true)
    expect(lines.some((l) => l.includes('1 unchanged'))).toBe(true)
    expect(lines.some((l) => l.includes('3 change(s) detected.'))).toBe(true)
  })

  it('prints change notes with their resource', () => {
    formatChangePlan([
      { action: 'update', type: 'statusPage', id: 'sp-1', name: 'Acme', details: ['headline'], notes: ['subdomain is read-only'] },
    ])

    expect(outputLines().some((l) => l.includes('note: statusPage/Acme: subdomain is read-only'))).toBe(true)
  })

  it('does not count no-change entries as changes', () => {
    formatChangePlan([
      { action: 'no-change', type: 'test', id: 'id-1', name: 'Same' },
    ])

    expect(outputLines().some((l) => l.includes('change(s) detected'))).toBe(false)
    expect(successSpy).toHaveBeenCalled()
  })
})
