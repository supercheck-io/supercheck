import { existsSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, resolve, posix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ApiClient } from '../api/client.js'
import type { SupercheckConfig } from '../config/schema.js'
import type { LocalResource, RemoteResource } from './reconcile.js'
import { CLIError, ExitCode } from './errors.js'
import { extractUuidFromFilename } from './slug.js'

const stateSchema = z.object({ version: z.literal(1), targets: z.record(z.record(z.string().uuid())) }).strict()
export type ProjectContext = {
  apiUrl?: string
  organization: { id: string; slug?: string | null }
  project: { id: string; slug?: string | null }
}
export async function verifyContext(client: ApiClient, config: Pick<SupercheckConfig, 'project'>, allowPlaceholders = false): Promise<ProjectContext> {
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
export function deploymentLock(configPath?: string | null): () => void {
  const path = resolve(dirname(configPath ?? resolve('supercheck.config.ts')), 'supercheck.state.json.lock')
  let fd: number
  try { fd = openSync(path, 'wx', 0o600) } catch { throw new CLIError(`DEPLOY_LOCKED: Another deploy may be active. If it stopped unexpectedly, inspect and remove ${path}.`, ExitCode.ConfigError) }
  writeFileSync(fd, `${process.pid}\n`)
  return () => { closeSync(fd); unlinkSync(path) }
}
export function managedState(client: ApiClient, context: ProjectContext, configPath?: string | null) {
  const path = resolve(dirname(configPath ?? resolve('supercheck.config.ts')), 'supercheck.state.json')
  let state: z.infer<typeof stateSchema>
  try { state = existsSync(path) ? stateSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : { version: 1, targets: {} } } catch {
    throw new CLIError(`Invalid managed state file: ${path}. Restore it before deploying; do not discard resource ownership.`, ExitCode.ConfigError)
  }
  const target = `${client.getBaseUrl()}|${context.organization.id}|${context.project.id}`
  const ids = state.targets[target] ?? {}
  const normalizeRef = (type: string, name: string) => type === 'test' ? posix.normalize(name.replace(/\\/g, '/')).replace(/^_supercheck_\//, '') : name
  const key = (type: string, name: string) => `${type}:${normalizeRef(type, name)}`
  const lookup = (type: string, ref: string): string | undefined => {
    const id = z.string().uuid().safeParse(ref).success ? ref : extractUuidFromFilename(ref)
    if (!id) return ids[key(type, ref)]
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
      const resolved = local.map((item) => ({ ...item, id: item.id ? lookup(item.type, item.id) : lookup(item.type, item.name) }))
      for (const item of resolved) if (item.id) ids[key(item.type, item.name)] = item.id
      return resolved
    },
    record(type: string, name: string, id: string, previousId?: string): void {
      if (!z.string().uuid().safeParse(id).success) throw new CLIError('Create response did not contain a valid resource UUID. Inspect remote state before retrying.', ExitCode.ApiError)
      if (previousId) for (const key of Object.keys(ids)) if (ids[key] === previousId) ids[key] = id
      ids[key(type, name)] = id
      if (previousId && previousId !== id) ids[`replacement:${type}:${previousId}`] = id
      state.targets[target] = ids
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
  for (const item of local) {
    if ((item.type === 'monitor' || item.type === 'job') && item.definition.tags !== undefined) throw new CLIError(`Tag assignments on ${item.type}/${item.name} are not supported by the current API. Standalone tag management remains available.`, ExitCode.ConfigError)
    const key = `${item.type}:${item.name}`
    const previous = seen.get(key)
    if (previous && (!item.id || !previous.id || item.id === previous.id)) throw new CLIError(`Duplicate local resource identity: ${key}. Give each new resource a unique name.`, ExitCode.ConfigError)
    seen.set(key, item)
  }
  for (const item of local) if (!item.id && remote.some((existing) => existing.type === item.type && existing.name === (item.definition.title ?? item.name))) {
    throw new CLIError(`UNMANAGED_RESOURCE: ${item.type}/${item.name} already exists. Pull or set its explicit ID to adopt it; names do not establish ownership.`, ExitCode.ConfigError)
  }
}
