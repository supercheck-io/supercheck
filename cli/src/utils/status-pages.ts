import type { ApiClient } from '../api/client.js'
import { ApiRequestError, CLIError, ExitCode } from './errors.js'
import { logger } from './logger.js'

type Rec = Record<string, unknown>

/** CLI `branding` key -> API column. */
export const BRANDING_KEYS = {
  bodyBackgroundColor: 'cssBodyBackgroundColor',
  fontColor: 'cssFontColor',
  lightFontColor: 'cssLightFontColor',
  greens: 'cssGreens',
  yellows: 'cssYellows',
  oranges: 'cssOranges',
  blues: 'cssBlues',
  reds: 'cssReds',
  borderColor: 'cssBorderColor',
  graphColor: 'cssGraphColor',
  linkColor: 'cssLinkColor',
  noData: 'cssNoData',
} as const

/** CLI `notifications` keys are the API column names. */
export const NOTIFICATION_KEYS = [
  'allowPageSubscribers',
  'allowEmailSubscribers',
  'allowWebhookSubscribers',
  'allowSlackSubscribers',
  'allowIncidentSubscribers',
  'allowRssFeed',
] as const

export const OLD_SERVER_STATUS_PAGE_MESSAGE =
  'This Supercheck server does not support status page create/update; upgrade the server or apply the change in the dashboard.'

export interface StatusPageComponent {
  id?: string
  name: string
  description?: string
  monitors: string[]
  position: number
}

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)
const uniqueSorted = (values: unknown[]): string[] => [...new Set(values.map(String))].sort()

/** Components as the API returns them (`monitorIds`) or the detail route (`monitors[]`), in the CLI config shape. */
export function normalizeRemoteComponents(components: Rec[]): StatusPageComponent[] {
  return components
    .map((component, index): StatusPageComponent => {
      const ids = Array.isArray(component.monitorIds)
        ? component.monitorIds
        : Array.isArray(component.monitors)
          ? (component.monitors as unknown[]).map((m) => (m && typeof m === 'object' ? (m as Rec).id : m))
          : []
      const description = asString(component.description)
      return {
        id: String(component.id),
        name: String(component.name ?? ''),
        ...(description !== undefined ? { description } : {}),
        monitors: uniqueSorted(ids),
        position: typeof component.position === 'number' ? component.position : index,
      }
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/**
 * The single place that turns an API status page (+ components) into the CLI config shape.
 * Used by `pull` and by remote normalization so pull -> diff is stable.
 */
export function statusPageToDefinition(page: Rec, components?: Rec[]): Rec {
  const def: Rec = { id: page.id, name: page.name }
  const description = asString(page.pageDescription) ?? asString(page.description)
  const simple: Array<[string, unknown]> = [
    ['subdomain', page.subdomain],
    ['status', page.status],
    ['description', description],
    ['headline', page.headline],
    ['supportUrl', page.supportUrl],
    ['language', page.language],
    ['timezone', page.timezone],
    ['customDomain', page.customDomain],
  ]
  for (const [key, value] of simple) {
    const text = asString(value)
    if (text !== undefined) def[key] = text
  }

  const branding: Rec = {}
  for (const [key, column] of Object.entries(BRANDING_KEYS)) {
    const value = asString(page[column])
    if (value) branding[key] = value.toLowerCase()
  }
  if (Object.keys(branding).length > 0) def.branding = branding

  const notifications: Rec = {}
  for (const key of NOTIFICATION_KEYS) if (typeof page[key] === 'boolean') notifications[key] = page[key]
  if (Object.keys(notifications).length > 0) def.notifications = notifications

  if (components) def.components = normalizeRemoteComponents(components)
  return def
}

/** Normalize a locally authored definition so it compares equal to `statusPageToDefinition` output. */
export function normalizeLocalStatusPage(definition: Rec): Rec {
  const def: Rec = { ...definition }
  if (def.branding && typeof def.branding === 'object') {
    def.branding = Object.fromEntries(
      Object.entries(def.branding as Rec).map(([key, value]) => [key, typeof value === 'string' ? value.toLowerCase() : value]),
    )
  }
  if (Array.isArray(def.components)) {
    def.components = (def.components as Rec[]).map((component, index) => ({
      ...component,
      monitors: uniqueSorted(Array.isArray(component.monitors) ? component.monitors : []),
      position: typeof component.position === 'number' ? component.position : index,
    }))
  }
  return def
}

/** Config shape -> API settings body (everything PUT /api/status-pages/:id accepts except `status`). Never includes `subdomain`. */
export function toApiSettings(def: Rec): Rec {
  const body: Rec = {}
  const copy = (from: string, to = from) => { if (def[from] !== undefined) body[to] = def[from] }
  copy('name')
  copy('headline')
  copy('description', 'pageDescription')
  copy('supportUrl')
  copy('timezone')
  copy('language')
  copy('customDomain')
  const notifications = (def.notifications ?? {}) as Rec
  for (const key of NOTIFICATION_KEYS) if (notifications[key] !== undefined) body[key] = notifications[key]
  const branding = (def.branding ?? {}) as Rec
  for (const [key, column] of Object.entries(BRANDING_KEYS)) {
    if (typeof branding[key] === 'string') body[column] = (branding[key] as string).toLowerCase()
  }
  return body
}

export interface ComponentPair {
  local: StatusPageComponent
  remote?: StatusPageComponent
}

/** Match local components to remote ones by id first, then by exact name. */
export function matchComponents(
  local: StatusPageComponent[],
  remote: StatusPageComponent[],
): { pairs: ComponentPair[]; unmatchedRemote: StatusPageComponent[] } {
  const used = new Set<StatusPageComponent>()
  const matched = new Map<StatusPageComponent, StatusPageComponent>()
  for (const item of local) {
    const byId = item.id ? remote.find((r) => r.id === item.id && !used.has(r)) : undefined
    if (byId) { used.add(byId); matched.set(item, byId) }
  }
  for (const item of local) {
    if (matched.has(item)) continue
    const byName = remote.find((r) => r.name === item.name && !used.has(r))
    if (byName) { used.add(byName); matched.set(item, byName) }
  }
  return {
    pairs: local.map((item) => ({ local: item, remote: matched.get(item) })),
    unmatchedRemote: remote.filter((r) => !used.has(r)),
  }
}

function componentChanges(local: StatusPageComponent, remote: StatusPageComponent): string[] {
  const changes: string[] = []
  if (local.name !== remote.name) changes.push('name')
  if ((local.description ?? '') !== (remote.description ?? '')) changes.push('description')
  if (JSON.stringify(uniqueSorted(local.monitors)) !== JSON.stringify(uniqueSorted(remote.monitors))) changes.push('monitors')
  if (local.position !== remote.position) changes.push('position')
  return changes
}

/** Human-readable diff lines for `components`; empty when equivalent. Order-insensitive (position is explicit). */
export function compareComponents(local: unknown, remote: unknown): string[] {
  const localComponents = (Array.isArray(local) ? local : []) as StatusPageComponent[]
  const remoteComponents = (Array.isArray(remote) ? remote : []) as StatusPageComponent[]
  const { pairs, unmatchedRemote } = matchComponents(localComponents, remoteComponents)
  const diffs: string[] = []
  for (const { local: l, remote: r } of pairs) {
    if (!r) diffs.push(`components: + "${l.name}"`)
    else {
      const changed = componentChanges(l, r)
      if (changed.length > 0) diffs.push(`components: ~ "${l.name}" (${changed.join(', ')})`)
    }
  }
  for (const r of unmatchedRemote) diffs.push(`components: - "${r.name}" (removed only with --delete)`)
  return diffs
}

/** Validate status page definitions before any write. Throws a ConfigError describing the first problem. */
export function validateStatusPageDefinition(definition: Rec, name: string): void {
  const components = definition.components
  if (Array.isArray(components)) {
    const names = new Set<string>()
    components.forEach((component: Rec, index) => {
      const componentName = String(component.name)
      if (names.has(componentName)) {
        throw new CLIError(`Status page "${name}" has two components named "${componentName}". Component names must be unique.`, ExitCode.ConfigError)
      }
      names.add(componentName)
      const position = typeof component.position === 'number' ? component.position : index
      if (position > 1000) {
        throw new CLIError(`Status page "${name}" component "${componentName}" has position ${position}; the maximum is 1000.`, ExitCode.ConfigError)
      }
    })
  }
  if (definition.status === 'published' && Array.isArray(components) && components.length === 0) {
    throw new CLIError(`Status page "${name}" is published but defines no components. Add at least one component before publishing.`, ExitCode.ConfigError)
  }
}

export interface ApplyStatusPageOptions {
  action: 'create' | 'update'
  /** Existing page id (update). */
  id?: string
  name: string
  /** Local definition (after normalization); monitor refs not yet resolved. */
  definition: Rec
  /** Remote definition in CLI shape (update only), used to send only changed settings. */
  remote?: Rec
  deleteMissing: boolean
  resolveMonitor: (ref: string) => string
  /** Called right after the page exists so its identity can be recorded before later steps run. */
  onCreated?: (id: string) => void
}

/**
 * Apply one status page: settings, then components, then status (publishing needs a public component).
 * The first write maps a 404/405 to an upgrade hint so an old server fails before anything is applied.
 */
export async function applyStatusPage(client: ApiClient, opts: ApplyStatusPageOptions): Promise<{ id: string }> {
  const { definition } = opts
  if (opts.action === 'create' && definition.subdomain !== undefined) {
    logger.debug(`Ignoring subdomain on status page "${opts.name}": the server generates it.`)
  }

  // Resolve every reference before the first write.
  const components: StatusPageComponent[] | undefined = Array.isArray(definition.components)
    ? (definition.components as StatusPageComponent[]).map((component) => ({
        ...component,
        monitors: uniqueSorted((component.monitors ?? []).map((ref) => opts.resolveMonitor(ref))),
      }))
    : undefined
  const settings = toApiSettings(definition)

  let first = true
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (!first) return fn()
    first = false
    try {
      return await fn()
    } catch (error) {
      if (error instanceof ApiRequestError && (error.statusCode === 404 || error.statusCode === 405)) {
        throw new CLIError(OLD_SERVER_STATUS_PAGE_MESSAGE, ExitCode.ApiError)
      }
      throw error
    }
  }

  let id = opts.id
  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (opts.action === 'create' && id) {
        throw new CLIError(`Status page "${opts.name}" was created (${id}) but ${label} failed: ${message}`, error instanceof CLIError ? error.exitCode : ExitCode.ApiError, { id })
      }
      throw error
    }
  }

  if (opts.action === 'create') {
    const createBody: Rec = { name: settings.name }
    for (const key of ['headline', 'pageDescription']) if (settings[key] !== undefined) createBody[key] = settings[key]
    const { data } = await call(() => client.post<Rec>('/api/status-pages', createBody))
    const created = ((data as Rec).statusPage ?? data) as Rec
    if (typeof created.id !== 'string') {
      throw new CLIError('Create succeeded but returned no ID. Inspect remote state before retrying.', ExitCode.ApiError)
    }
    id = created.id
    opts.onCreated?.(id)
    delete settings.name
    delete settings.headline
    delete settings.pageDescription
  } else {
    const remoteSettings = toApiSettings(opts.remote ?? {})
    for (const key of Object.keys(settings)) {
      if (JSON.stringify(settings[key]) === JSON.stringify(remoteSettings[key])) delete settings[key]
    }
  }
  const pageId = id!

  if (Object.keys(settings).length > 0) {
    await step('applying settings', () => call(() => client.put(`/api/status-pages/${pageId}`, settings)))
  }

  if (components) {
    await step('syncing components', async () => {
      let remoteComponents: StatusPageComponent[] = []
      if (opts.action === 'update') {
        const { data } = await call(() => client.get<Rec>(`/api/status-pages/${pageId}/components`))
        remoteComponents = normalizeRemoteComponents(((data as Rec).components ?? []) as Rec[])
      }
      const { pairs, unmatchedRemote } = matchComponents(components, remoteComponents)
      for (const { local, remote } of pairs) {
        if (!remote) {
          await call(() => client.post(`/api/status-pages/${pageId}/components`, {
            name: local.name,
            ...(local.description !== undefined ? { description: local.description } : {}),
            monitorIds: local.monitors,
            position: local.position,
          }))
          continue
        }
        const changed = componentChanges(local, remote)
        if (changed.length === 0) continue
        const body: Rec = {}
        if (changed.includes('name')) body.name = local.name
        if (changed.includes('description')) body.description = local.description ?? null
        if (changed.includes('monitors')) body.monitorIds = local.monitors
        if (changed.includes('position')) body.position = local.position
        await call(() => client.put(`/api/status-pages/${pageId}/components/${remote.id}`, body))
      }
      for (const orphan of unmatchedRemote) {
        if (opts.deleteMissing) await call(() => client.delete(`/api/status-pages/${pageId}/components/${orphan.id}`))
        else logger.warn(`Status page "${opts.name}": component "${orphan.name}" is not in config; kept (use --delete to remove it).`)
      }
    })
  }

  const desired = asString(definition.status)
  const current = opts.action === 'create' ? 'draft' : asString(opts.remote?.status)
  if (desired && desired !== current) {
    await step('changing status', () => call(() => client.put(`/api/status-pages/${pageId}`, { status: desired })))
  }
  return { id: pageId }
}
