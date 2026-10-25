import { redact } from './redact.js'
import pc from './colors.js'
import { logger } from './logger.js'
import { diffComponents } from './status-pages.js'

/**
 * Represents a resource defined in the local config file.
 */
export interface LocalResource {
  /** Database UUID if this resource already exists on the server. Absent for new resources. */
  id?: string
  type: 'test' | 'monitor' | 'job' | 'variable' | 'tag' | 'statusPage' | 'notificationProvider' | 'requirement'
  name: string
  definition: Record<string, unknown>
}

/**
 * Represents a resource fetched from the remote Supercheck API.
 */
export interface RemoteResource {
  id: string
  type: 'test' | 'monitor' | 'job' | 'variable' | 'tag' | 'statusPage' | 'notificationProvider' | 'requirement'
  name: string
  raw: Record<string, unknown>
}

export type ChangeAction = 'create' | 'update' | 'delete' | 'no-change'

export interface ResourceChange {
  action: ChangeAction
  type: LocalResource['type']
  id?: string
  name: string
  local?: LocalResource
  remote?: RemoteResource
  details?: string[]
  /** Informational only: differences that are not changes (e.g. remote-only components kept without --delete). */
  notes?: string[]
}

/**
 * Compare local config resources against remote API resources
 * using id-based reconciliation.
 *
 * - Resources with an `id` in local config are matched against remote by `type:id`.
 * - Resources without an `id` in local config are treated as new (create).
 * - Remote resources whose `id` does not appear in any local resource are candidates for deletion.
 */
export function reconcile(
  local: LocalResource[],
  remote: RemoteResource[],
  options: { deleteMissing?: boolean } = {},
): ResourceChange[] {
  const changes: ResourceChange[] = []

  // Build lookup maps by type + id
  const remoteByKey = new Map<string, RemoteResource>()
  for (const r of remote) {
    remoteByKey.set(`${r.type}:${r.id}`, r)
  }

  const localByKey = new Map<string, LocalResource>()
  for (const l of local) {
    if (l.id) {
      localByKey.set(`${l.type}:${l.id}`, l)
    }
  }

  // Detect creates and updates
  for (const l of local) {
    if (!l.id) {
      // No id = new resource to create
      changes.push({
        action: 'create',
        type: l.type,
        name: l.name,
        local: l,
      })
      continue
    }

    const key = `${l.type}:${l.id}`
    const r = remoteByKey.get(key)

    if (!r) {
      // Has id but not found on remote — treat as create (might have been deleted server-side)
      changes.push({
        action: 'create',
        type: l.type,
        id: l.id,
        name: l.name,
        local: l,
      })
    } else {
      const notes: string[] = []
      const diffs = diffFields(l.definition, r.raw, l.type, options.deleteMissing === true, notes)
      const noteField = notes.length > 0 ? { notes } : {}
      if (diffs.length > 0) {
        changes.push({
          action: 'update',
          type: l.type,
          id: l.id,
          name: l.name,
          local: l,
          remote: r,
          details: diffs,
          ...noteField,
        })
      } else {
        changes.push({
          action: 'no-change',
          type: l.type,
          id: l.id,
          name: l.name,
          local: l,
          remote: r,
          ...noteField,
        })
      }
    }
  }

  // Detect deletes — remote resources NOT in local config
  for (const r of remote) {
    const key = `${r.type}:${r.id}`
    if (!localByKey.has(key)) {
      changes.push({
        action: 'delete',
        type: r.type,
        id: r.id,
        name: r.name,
        remote: r,
      })
    }
  }

  return changes
}

/**
 * Produce a stable JSON string with sorted keys to avoid false diffs
 * caused by different key insertion order in objects.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce<Record<string, unknown>>((sorted, k) => {
        sorted[k] = (v as Record<string, unknown>)[k]
        return sorted
      }, {})
    }
    return v
  })
}

/**
 * Shallow diff between local definition fields and remote raw fields.
 * Returns a list of human-readable change descriptions.
 */
function diffFields(local: Record<string, unknown>, remote: Record<string, unknown>, resourceType?: string, deleteMissing = false, notes: string[] = []): string[] {
  const diffs: string[] = []
  const maskedFields = Array.isArray(remote.__maskedFields)
    ? (remote.__maskedFields as unknown[]).filter((field): field is string => typeof field === 'string')
    : []
  // Only compare fields present in the local definition
  for (const [key, localVal] of Object.entries(local)) {
    if (localVal === undefined) continue
    // Skip internal/metadata fields
    if (['id', 'createdAt', 'updatedAt', 'projectId', 'organizationId', 'createdByUserId', '__maskedFields'].includes(key)) continue
    // Read-only, server-generated: pulled but never compared.
    if (resourceType === 'statusPage' && key === 'subdomain') continue
    if (resourceType === 'statusPage' && key === 'components') {
      const { changes, extras } = diffComponents(localVal, remote[key])
      diffs.push(...changes)
      if (deleteMissing) diffs.push(...extras.map((name) => `components: - "${name}"`))
      else if (extras.length > 0) notes.push(`status page keeps ${extras.length} remote-only component(s) (${extras.join(', ')}); deploy --delete removes them`)
      continue
    }

    // For secret variables, the remote API returns an empty/masked value for security.
    // Skip comparing secret values to prevent phantom diffs and secret leakage in stdout.
    if (key === 'value' && (local.isSecret || remote.isSecret)) continue

    let remoteVal = remote[key]
    // Partially specified nested settings only compare the keys the config sets.
    if (resourceType === 'statusPage' && (key === 'branding' || key === 'notifications') && localVal && typeof localVal === 'object' && remoteVal && typeof remoteVal === 'object') {
      remoteVal = Object.fromEntries(Object.keys(localVal as object).filter((k) => k in (remoteVal as object)).map((k) => [k, (remoteVal as Record<string, unknown>)[k]]))
    }
    const [comparableLocal, comparableRemote] = key === 'tags' && Array.isArray(localVal) && Array.isArray(remoteVal)
      ? [foldTags(localVal), foldTags(remoteVal)]
      : key === 'config'
      ? stripMaskedConfigFields(localVal, remoteVal, maskedFields)
      : [localVal, remoteVal]
    if (stableStringify(comparableLocal) !== stableStringify(comparableRemote)) {
      diffs.push(`${key}: ${JSON.stringify(redact({ type: local.type ?? remote.type, [key]: comparableRemote })[key])} -> ${JSON.stringify(redact({ type: local.type ?? remote.type, [key]: comparableLocal })[key])}`)
    }
  }
  return diffs
}

/** Tag names compare case-insensitively (the server matches them that way and keeps the stored spelling). */
function foldTags(tags: unknown[]): string[] {
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()))].sort()
}

function stripMaskedConfigFields(
  local: unknown,
  remote: unknown,
  maskedFields: string[],
): [unknown, unknown] {
  if (maskedFields.length === 0) return [local, remote]
  if (!local || typeof local !== 'object' || Array.isArray(local)) return [local, remote]
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return [local, remote]

  const localConfig = { ...(local as Record<string, unknown>) }
  const remoteConfig = { ...(remote as Record<string, unknown>) }
  for (const field of maskedFields) {
    if (Object.prototype.hasOwnProperty.call(localConfig, field)) {
      localConfig[field] = '[local secret provided]'
      remoteConfig[field] = '[remote secret masked]'
    } else {
      delete localConfig[field]
      delete remoteConfig[field]
    }
  }

  return [localConfig, remoteConfig]
}

/**
 * Format a change plan for display in the terminal.
 */
export function formatChangePlan(changes: ResourceChange[]): void {
  const creates = changes.filter((c) => c.action === 'create')
  const updates = changes.filter((c) => c.action === 'update')
  const deletes = changes.filter((c) => c.action === 'delete')
  const unchanged = changes.filter((c) => c.action === 'no-change')

  logger.newline()
  logger.header('Change Plan')
  logger.newline()

  if (creates.length > 0) {
    logger.info(pc.green(`  + ${creates.length} to create`))
    for (const c of creates) {
      logger.info(pc.green(`    + ${c.type}/${c.name}`))
    }
  }

  if (updates.length > 0) {
    logger.info(pc.yellow(`  ~ ${updates.length} to update`))
    for (const c of updates) {
      logger.info(pc.yellow(`    ~ ${c.type}/${c.name} (${c.id})`))
      if (c.details) {
        for (const d of c.details) {
          logger.info(pc.gray(`        ${d}`))
        }
      }
    }
  }

  if (deletes.length > 0) {
    logger.info(pc.red(`  - ${deletes.length} to delete`))
    for (const c of deletes) {
      logger.info(pc.red(`    - ${c.type}/${c.name} (${c.id})`))
    }
  }

  if (unchanged.length > 0) {
    logger.info(pc.gray(`  = ${unchanged.length} unchanged`))
  }

  const notes = changes.flatMap((c) => (c.notes ?? []).map((n) => `${c.type}/${c.name}: ${n}`))
  if (notes.length > 0) {
    for (const n of notes) logger.info(pc.gray(`  note: ${n}`))
  }

  logger.newline()

  const totalChanges = creates.length + updates.length + deletes.length
  if (totalChanges === 0) {
    logger.success('No changes detected. Everything is in sync.')
  } else {
    logger.info(`${pc.bold(String(totalChanges))} change(s) detected.`)
  }
  logger.newline()
}
