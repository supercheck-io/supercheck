import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, linkSync } from 'node:fs'
import { dirname, resolve, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants as osConstants, hostname } from 'node:os'
import { z } from 'zod'
import type { ApiClient } from '../api/client.js'
import type { SupercheckConfig } from '../config/schema.js'
import type { LocalResource, RemoteResource } from './reconcile.js'
import { CLIError, ExitCode } from './errors.js'
import { extractUuidFromFilename } from './slug.js'

const stateSchema = z.object({ version: z.literal(1), targets: z.record(z.string(), z.record(z.string(), z.string().uuid())) }).strict()
export type ProjectContext = {
  apiUrl?: string
  organization: { id: string; slug?: string | null }
  project: { id: string; slug?: string | null }
}
const originOf = (url: string): string => { try { return new URL(url).origin } catch { return url } }
export function describeTarget(context: ProjectContext): string {
  return `${context.apiUrl} · organization ${context.organization.slug ?? context.organization.id} · project ${context.project.slug ?? context.project.id}`
}
/** Network-free: refuse a config that declares a different API origin than the active client (env or stored login URL wins). */
export function assertDeclaredOrigin(client: ApiClient, declared?: string | null): void {
  if (declared && originOf(declared) !== originOf(client.getBaseUrl())) {
    throw new CLIError(`CONTEXT_MISMATCH: Config api.baseUrl "${declared}" does not match the active API "${client.getBaseUrl()}" (from SUPERCHECK_URL or a stored login --url). Align them before syncing.`, ExitCode.ConfigError)
  }
}
// `declaredBaseUrl` is the config file's own api.baseUrl; the loaded config's value already has SUPERCHECK_URL applied.
export async function verifyContext(client: ApiClient, config: Pick<SupercheckConfig, 'project'>, allowPlaceholders = false, declaredBaseUrl?: string | null): Promise<ProjectContext> {
  assertDeclaredOrigin(client, declaredBaseUrl)
  const { data } = await client.get<ProjectContext>('/api/context')
  if (!data.organization?.id || !data.project?.id) throw new CLIError('Invalid project context response.', ExitCode.ApiError)
  for (const key of ['organization', 'project'] as const) {
    const expected = config.project[key]
    const actual = data[key]
    if (allowPlaceholders && ['my-org', 'my-project', 'unknown-org', 'unknown-project'].includes(expected)) continue
    if (expected !== actual.id && expected !== actual.slug) throw new CLIError(`CONTEXT_MISMATCH: Config ${key} "${expected}" does not match token ${key} "${actual.id}". Check whoami and SUPERCHECK_TOKEN.`, ExitCode.ConfigError)
  }
  return { ...data, apiUrl: client.getBaseUrl() }
}
const parseLock = (text: string): [number, string] => { const [pid = '', host = ''] = text.split('\n'); return [Number.parseInt(pid, 10), host.trim()] }
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}
export function deploymentLock(configPath?: string | null): () => void {
  const path = resolve(dirname(configPath ?? resolve('supercheck.config.ts')), 'supercheck.state.json.lock')
  const locked = () => new CLIError(`DEPLOY_LOCKED: Another deploy may be active. If it stopped unexpectedly, inspect and remove ${path}.`, ExitCode.ConfigError)
  const lockBody = `${process.pid}\n${hostname()}\n`
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, lockBody, { flag: 'wx', mode: 0o600 })
  let acquired = false
  try {
  for (let attempt = 0; !acquired; attempt++) {
    try { linkSync(temporaryPath, path); acquired = true } catch {
      // Recover only from a lock whose owning process is verifiably gone (crash or kill); anything uncertain stays locked.
      let owner = NaN, ownerHost = ''
      try { [owner, ownerHost] = parseLock(readFileSync(path, 'utf8')) } catch { /* unreadable lock stays locked */ }
      // A PID is only meaningful on the host that wrote it; a lock from another host or container stays locked.
      if (attempt > 0 || !Number.isInteger(owner) || owner <= 0 || ownerHost !== hostname() || processAlive(owner)) throw locked()
      // Move the stale lock aside rather than deleting it, then confirm it was still the dead owner's: if another process
      // took over in between, put its lock back and stay locked. PID checks are only valid on one host / PID namespace.
      const aside = `${path}.${randomUUID()}.stale`
      try { renameSync(path, aside) } catch { throw locked() }
      let moved = NaN
      try { moved = parseLock(readFileSync(aside, 'utf8'))[0] } catch { /* treated as foreign */ }
      if (moved !== owner) { try { linkSync(aside, path) } catch { /* the other owner's lock already exists */ } }
      try { unlinkSync(aside) } catch { /* best effort */ }
      if (moved !== owner) throw locked()
    }
  }
  } finally {
    unlinkSync(temporaryPath)
  }
  let released = false
  const release = () => {
    if (released) return
    released = true
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
    // Remove the lock only if it is still ours, so a late release cannot delete a successor's lock.
    try { if (readFileSync(path, 'utf8') === lockBody) unlinkSync(path) } catch { /* already removed; must not mask the deploy outcome */ }
  }
  const onSignal = (signal: NodeJS.Signals) => { release(); process.exit(128 + (osConstants.signals[signal] ?? 0)) }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  return release
}
export function managedState(client: ApiClient, context: ProjectContext, configPath?: string | null) {
  const path = resolve(dirname(configPath ?? resolve('supercheck.config.ts')), 'supercheck.state.json')
  let state: z.infer<typeof stateSchema>
  try { state = existsSync(path) ? stateSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : { version: 1, targets: {} } } catch {
    throw new CLIError(`Invalid managed state file: ${path}. Restore it before deploying; do not discard resource ownership.`, ExitCode.ConfigError)
  }
  const target = `${client.getBaseUrl()}|${context.organization.id}|${context.project.id}`
  const ids = state.targets[target] ?? {}
  const aliases: Record<string, string> = {}
  const retiredAliases = new Set<string>()
  const normalizeRef = (type: string, name: string) => type === 'test' ? posix.normalize(name.replace(/\\/g, '/')).replace(/^_supercheck_\//, '') : name
  const key = (type: string, name: string) => `${type}:${normalizeRef(type, name)}`
  const lookup = (type: string, ref: string): string | undefined => {
    const id = z.string().uuid().safeParse(ref).success ? ref : extractUuidFromFilename(ref)
    if (!id) return aliases[key(type, ref)] ?? (retiredAliases.has(key(type, ref)) ? undefined : ids[key(type, ref)])
    let current = id
    const visited = new Set<string>()
    while (ids[`replacement:${type}:${current}`]) {
      if (visited.has(current)) throw new CLIError('Managed state contains a replacement cycle. Restore valid state before deploying.', ExitCode.ConfigError)
      visited.add(current)
      current = ids[`replacement:${type}:${current}`]
    }
    return current
  }
  return {
    path, target,
    apply(local: LocalResource[]): LocalResource[] {
      // An explicit ID carries ownership through a rename; its old name must not adopt a new definition.
      for (const item of local) if (item.id) {
        const id = lookup(item.type, item.id)
        for (const [alias, ownedId] of Object.entries(ids)) {
          if (alias.startsWith(`${item.type}:`) && alias !== key(item.type, item.name) && lookup(item.type, ownedId) === id) retiredAliases.add(alias)
        }
      }
      const resolved = local.map((item) => ({ ...item, id: item.id ? lookup(item.type, item.id) : lookup(item.type, item.name) }))
      for (const item of resolved) if (item.id) aliases[key(item.type, item.name)] = item.id
      return resolved
    },
    record(type: string, name: string, id: string, previousId?: string): void {
      if (!z.string().uuid().safeParse(id).success) throw new CLIError('Create response did not contain a valid resource UUID. Inspect remote state before retrying.', ExitCode.ApiError)
      const before = JSON.stringify(state)
      for (const [alias, ownedId] of Object.entries(ids)) {
        if (alias.startsWith(`${type}:`) && alias !== key(type, name) && (lookup(type, ownedId) === id || (previousId && lookup(type, ownedId) === lookup(type, previousId)))) {
          delete ids[alias]
          retiredAliases.add(alias)
        }
      }
      if (previousId) for (const key of Object.keys(ids)) if (ids[key] === previousId) ids[key] = id
      ids[key(type, name)] = id
      aliases[key(type, name)] = id
      if (previousId && previousId !== id) ids[`replacement:${type}:${previousId}`] = id
      state.targets[target] = ids
      if (JSON.stringify(state) === before) return
      const temp = `${path}.${randomUUID()}.tmp`
      try { writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }); renameSync(temp, path) }
      finally { if (existsSync(temp)) unlinkSync(temp) }
    },
    resolve(type: string, ref: string): string {
      const id = lookup(type, ref)
      if (!id) throw new CLIError(`Unresolved ${type} reference "${ref}". Deploy its definition first or use an explicit UUID.`, ExitCode.ConfigError)
      return id
    },
    resolveTests(local: LocalResource[]): LocalResource[] {
      return local.map((resource) => {
        const definition = { ...resource.definition }
        if (definition.alertConfig && typeof definition.alertConfig === 'object' && 'notificationProviders' in definition.alertConfig && Array.isArray(definition.alertConfig.notificationProviders)) {
          definition.alertConfig = { ...definition.alertConfig, notificationProviders: definition.alertConfig.notificationProviders.map((ref) => lookup('notificationProvider', String(ref)) ?? ref) }
        }
        const item = { ...resource, definition }
        if (item.type === 'requirement' && Array.isArray(item.definition.tests)) {
          return { ...item, definition: { ...item.definition, tests: [...new Set(item.definition.tests.map((ref) => lookup('test', String(ref)) ?? String(ref)))].sort() } }
        }
        if (item.type === 'statusPage' && Array.isArray(item.definition.components)) {
          const components = (item.definition.components as Array<Record<string, unknown>>).map((component) => ({
            ...component,
            monitors: Array.isArray(component.monitors) ? [...new Set((component.monitors as unknown[]).map((ref) => lookup('monitor', String(ref)) ?? String(ref)))].sort() : component.monitors,
          }))
          return { ...item, definition: { ...item.definition, components } }
        }
        if (item.type === 'job' && Array.isArray(item.definition.tests)) {
          return { ...item, definition: { ...item.definition, tests: item.definition.tests.map((ref) => lookup('test', String(ref)) ?? ref) } }
        }
        const config = item.definition.config
        if (item.type === 'monitor' && item.definition.type === 'synthetic_test' && config && typeof config === 'object' && 'testId' in config && typeof config.testId === 'string') {
          return { ...item, definition: { ...item.definition, config: { ...config, testId: lookup('test', config.testId) ?? config.testId } } }
        }
        return item
      })
    },
  }
}
export function rejectAmbiguousCreates(local: LocalResource[], remote: RemoteResource[]): void {
  const seen = new Map<string, LocalResource>()
  const seenIds = new Set<string>()
  for (const item of local) {
    if (item.id) {
      const identity = `${item.type}:${item.id}`
      if (seenIds.has(identity)) throw new CLIError(`Duplicate local resource ID: ${identity}. Define each resource only once.`, ExitCode.ConfigError)
      seenIds.add(identity)
    }
    const key = `${item.type}:${item.name}`
    const previous = seen.get(key)
    if (previous && (!item.id || !previous.id || item.id === previous.id)) throw new CLIError(`Duplicate local resource identity: ${key}. Give each new resource a unique name.`, ExitCode.ConfigError)
    seen.set(key, item)
  }
  for (const item of local) if (!item.id && remote.some((existing) => existing.type === item.type && existing.name === (item.definition.title ?? item.name))) {
    throw new CLIError(`UNMANAGED_RESOURCE: ${item.type}/${item.name} already exists. Pull or set its explicit ID to adopt it; names do not establish ownership.`, ExitCode.ConfigError)
  }
}
