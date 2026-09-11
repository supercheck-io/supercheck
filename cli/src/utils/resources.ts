import { getApiClient } from '../api/client.js'
import { discoverFiles, readFileContent } from './discovery.js'
import { logger } from './logger.js'
import { ApiRequestError } from './errors.js'
import { extractUuidFromFilename, stripTitleMetadata } from './slug.js'
import { decodeStoredTestScript, sanitizeTestScript } from './script.js'
import type { LocalResource, RemoteResource } from './reconcile.js'
import type { SupercheckConfig } from '../config/schema.js'
import type { PaginatedResponse } from '../api/client.js'

/**
 * Build local resource list from the loaded config + discovered files.
 */
export function buildLocalResources(config: SupercheckConfig, cwd: string): LocalResource[] {
  const resources: LocalResource[] = []

  if (config.jobs) {
    for (const job of config.jobs) {
      // Strip runtime-only `status` from job definitions — it's not config
      const { status: _status, ...jobWithoutStatus } = job // eslint-disable-line @typescript-eslint/no-unused-vars
      resources.push({
        id: job.id,
        type: 'job',
        name: job.name,
        definition: {
          ...jobWithoutStatus,
          tests: normalizeJobTestsToIds(job.tests),
        },
      })
    }
  }

  if (config.variables) {
    for (const v of config.variables) {
      resources.push({
        id: v.id,
        type: 'variable',
        name: v.key,
        definition: { key: v.key, value: v.value, isSecret: v.isSecret, description: v.description },
      })
    }
  }

  if (config.tags) {
    for (const t of config.tags) {
      resources.push({
        id: t.id,
        type: 'tag',
        name: t.name,
        definition: { name: t.name, color: t.color },
      })
    }
  }

  if (config.notificationProviders) {
    for (const provider of config.notificationProviders) {
      resources.push({
        id: provider.id,
        type: 'notificationProvider',
        name: provider.name,
        definition: {
          id: provider.id,
          name: provider.name,
          type: provider.type,
          config: provider.config,
        },
      })
    }
  }

  if (Array.isArray(config.monitors)) {
    for (const m of config.monitors) {
      resources.push({
        id: m.id,
        type: 'monitor',
        name: m.name,
        definition: { ...m },
      })
    }
  } else if (typeof config.monitors === 'string') {
    logger.warn(
      `monitors is set to a glob pattern ("${config.monitors}") but glob-based monitor discovery is not yet implemented. ` +
      'Define monitors as an inline array in your config, or remove the monitors field.',
    )
  }

  if (Array.isArray(config.statusPages)) {
    for (const sp of config.statusPages) {
      resources.push({
        id: sp.id,
        type: 'statusPage',
        name: sp.name,
        definition: { ...sp },
      })
    }
  } else if (typeof config.statusPages === 'string') {
    logger.warn(
      `statusPages is set to a glob pattern ("${config.statusPages}") but glob-based status page discovery is not yet implemented. ` +
      'Define status pages as an inline array in your config, or remove the statusPages field.',
    )
  }

  const patterns = {
    playwright: config.tests?.playwright?.testMatch,
    k6: config.tests?.k6?.testMatch,
  }
  const files = discoverFiles(cwd, patterns)
  for (const file of files) {
    const script = readFileContent(file.absolutePath)
    if (script) {
      // Parse UUID from filename — supports both formats:
      //   slug.uuid.pw.ts (new)  and  uuid.pw.ts (legacy)
      const testId = extractUuidFromFilename(file.filename)

      if (!testId) {
        logger.debug(`Test file "${file.filename}" does not have a UUID-based filename — will be treated as a new resource`)
      }

      // Parse metadata from script content (e.g. // @title My Test Title or * @title My Test Title)
      const titleMatch = script.match(/@title\s+(.+)$/m)
      const stem = file.filename.replace(/\.(pw|k6)\.ts$/, '')
      const title = titleMatch ? titleMatch[1].trim() : stem

      // Strip @title metadata from script for comparison/deploy.
      // The @title annotation is local-only developer convenience;
      // the `title` field is the canonical source for the test name.
      const cleanScript = sanitizeTestScript(stripTitleMetadata(script))

      const displayName = file.relativePath.replace(/^_supercheck_\//, '')

      resources.push({
        id: testId,
        type: 'test',
        name: displayName,
        definition: {
          id: testId,
          title,
          testType: file.type === 'playwright' ? 'playwright' : 'k6',
          script: cleanScript,
        },
      })
    }
  }

  return resources
}

/** Maximum items per page when fetching paginated resources. */
const PAGE_LIMIT = 200

/**
 * Fetch all pages of a paginated API endpoint.
 *
 * Iterates through every page so that reconciliation and destroy commands
 * see the complete set of remote resources, regardless of how many exist.
 */
export async function fetchAllPages<T = Record<string, unknown>>(
  client: ReturnType<typeof getApiClient>,
  endpoint: string,
  label: string,
): Promise<T[]> {
  const items: T[] = []
  let page = 1
  let totalPages = 1

  do {
    const { data } = await client.get<PaginatedResponse<T>>(endpoint, {
      limit: String(PAGE_LIMIT),
      page: String(page),
    })

    const pageData = data as unknown
    let pageItems: T[] = []
    if (Array.isArray(pageData)) {
      pageItems = pageData as T[]
    } else if (pageData && typeof pageData === 'object' && Array.isArray((pageData as Record<string, unknown>).data)) {
      pageItems = (pageData as Record<string, unknown>).data as T[]
    }

    items.push(...pageItems)

    if (pageData && typeof pageData === 'object' && (pageData as Record<string, unknown>).pagination) {
      const pagination = (pageData as Record<string, unknown>).pagination as { totalPages?: number }
      if (typeof pagination.totalPages === 'number') {
        totalPages = pagination.totalPages
      }
    }

    page++
  } while (page <= totalPages)

  if (totalPages > 1) {
    logger.debug(`Fetched ${totalPages} pages of ${label} (${items.length} total)`)
  }

  return items
}

/**
 * Safely extract a string `id` from a raw resource record.
 * Returns `undefined` if the value is missing or not a usable identifier.
 */
function safeId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const str = String(value)
  if (str === 'undefined' || str === 'null' || str === '') return undefined
  return str
}

/**
 * Normalize an alertConfig object by removing server defaults.
 * Mirrors the stripping logic in pull.ts buildMonitorDefinitions/buildJobDefinitions.
 */
function normalizeAlertConfig(alert: Record<string, unknown>): Record<string, unknown> | undefined {
  const normalized = { ...alert }

  // Remove empty/default values
  if (normalized.customMessage === '' || normalized.customMessage === null) delete normalized.customMessage
  if (normalized.failureThreshold === 1) delete normalized.failureThreshold
  if (normalized.recoveryThreshold === 1) delete normalized.recoveryThreshold

  // Remove false boolean flags (they're defaults)
  for (const key of ['alertOnFailure', 'alertOnRecovery', 'alertOnSslExpiration', 'alertOnSuccess', 'alertOnTimeout']) {
    if (normalized[key] === false) delete normalized[key]
  }

  // Remove empty notificationProviders array
  if (Array.isArray(normalized.notificationProviders) && (normalized.notificationProviders as string[]).length === 0) {
    delete normalized.notificationProviders
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * Normalize monitor config by removing runtime-only and default fields.
 * Mirrors pull.ts buildMonitorDefinitions stripping logic.
 */
function normalizeMonitorConfig(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const normalized = { ...config }

  // Remove runtime-only fields
  delete normalized.sslLastCheckedAt
  delete normalized.aggregatedAlertState

  // Clean up default playwrightOptions
  if (normalized.playwrightOptions && typeof normalized.playwrightOptions === 'object') {
    const opts = { ...(normalized.playwrightOptions as Record<string, unknown>) }
    if (opts.retries === 0) delete opts.retries
    if (opts.timeout === 300000) delete opts.timeout
    if (opts.headless === true) delete opts.headless
    normalized.playwrightOptions = Object.keys(opts).length > 0 ? opts : undefined
    if (!normalized.playwrightOptions) delete normalized.playwrightOptions
  }

  // Clean up locationConfig
  if (normalized.locationConfig && typeof normalized.locationConfig === 'object') {
    const loc = { ...(normalized.locationConfig as Record<string, unknown>) }
    const hasLocations = Array.isArray(loc.locations) && (loc.locations as string[]).length > 0
    if (!loc.enabled || !hasLocations) {
      delete normalized.locationConfig
    } else {
      if (loc.enabled === true) delete loc.enabled
      if (loc.strategy === 'majority') delete loc.strategy
      if (loc.threshold === 50) delete loc.threshold
      normalized.locationConfig = Object.keys(loc).length > 0 ? loc : undefined
      if (!normalized.locationConfig) delete normalized.locationConfig
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

/**
 * Normalize remote resource raw data to match the shape that pull generates in config.
 * This ensures round-trip fidelity: pull → diff produces no phantom changes.
 */
function normalizeRemoteRaw(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...raw }

  // Remove metadata fields that are never written to config
  delete normalized.createdAt
  delete normalized.updatedAt
  delete normalized.projectId
  delete normalized.organizationId
  delete normalized.createdByUserId

  if (type === 'monitor') {
    if (normalized.config && typeof normalized.config === 'object') {
      normalized.config = normalizeMonitorConfig(normalized.config as Record<string, unknown>)
      if (!normalized.config) delete normalized.config
    }
    if (normalized.alertConfig && typeof normalized.alertConfig === 'object') {
      normalized.alertConfig = normalizeAlertConfig(normalized.alertConfig as Record<string, unknown>)
      if (!normalized.alertConfig) delete normalized.alertConfig
    }
  }

  if (type === 'test') {
    // Map API 'type' to 'testType' matching local resource structure
    // k6/performance tests map to 'k6'; all other types (browser, api, database, custom) map to 'playwright'
    if (normalized.type === 'performance') normalized.testType = 'k6'
    else normalized.testType = 'playwright'

    // Remove original 'type' field to avoid field mismatch in diff
    delete normalized.type

    // Strip @title metadata from script for clean comparison.
    // The @title is a local-only annotation injected during pull;
    // title is already tracked as a separate field.
    if (typeof normalized.script === 'string') {
      normalized.script = stripTitleMetadata(
        decodeStoredTestScript(normalized.script) ?? normalized.script,
      )
    }
  }

  if (type === 'job') {
    // Normalize tests array to UUIDs for stable diff/deploy comparisons
    if (Array.isArray(normalized.tests)) {
      normalized.tests = (normalized.tests as Array<Record<string, unknown> | string>).map((t) => {
        if (typeof t === 'string') return extractUuidFromFilename(t) ?? t
        if (t && typeof t === 'object' && t.id) {
          return String(t.id)
        }
        return t
      })
    }

    if (normalized.alertConfig && typeof normalized.alertConfig === 'object') {
      normalized.alertConfig = normalizeAlertConfig(normalized.alertConfig as Record<string, unknown>)
      if (!normalized.alertConfig) delete normalized.alertConfig
    }

    // Remove runtime state
    delete normalized.status
  }

  if (type === 'variable') {
    // Normalize: pull writes value as empty string for secrets, normalise undefined → ''
    if (normalized.value === undefined || normalized.value === null) {
      normalized.value = ''
    }
  }

  if (type === 'statusPage') {
    // Normalize description field name: API may use pageDescription
    if (normalized.pageDescription !== undefined && normalized.description === undefined) {
      normalized.description = normalized.pageDescription
    }
    delete normalized.pageDescription
    // Normalize: empty/undefined description
    if (!normalized.description) delete normalized.description
  }

  if (type === 'notificationProvider') {
    const maskedFields = Array.isArray(normalized.maskedFields)
      ? (normalized.maskedFields as unknown[]).filter((field): field is string => typeof field === 'string')
      : []
    if (maskedFields.length > 0) {
      normalized.__maskedFields = maskedFields
    }
    delete normalized.maskedFields
    delete normalized.lastUsed
    delete normalized.isEnabled

    // Normalize config.name to the top-level name so pull -> diff is stable
    // even when the stored config omits the redundant inner name.
    if (normalized.config && typeof normalized.config === 'object') {
      const config = normalized.config as Record<string, unknown>
      config.name = normalized.name ?? config.name
    }
  }

  return normalized
}

/**
 * Normalize job test references to UUIDs.
 * Accepts IDs, filenames, or paths and returns UUIDs when possible.
 */
function normalizeJobTestsToIds(tests: string[] | undefined): string[] | undefined {
  if (!tests) return tests

  return tests.map((t) => {
    const id = extractUuidFromFilename(t)
    return id ?? t
  })
}

/**
 * Fetch remote resources from the Supercheck API.
 */
export async function fetchRemoteResources(client: ReturnType<typeof getApiClient>): Promise<RemoteResource[]> {
  const resources: RemoteResource[] = []

  try {
    const jobs = await fetchAllPages<Record<string, unknown>>(client, '/api/jobs', 'jobs')
    for (const job of jobs) {
      const id = safeId(job.id)
      if (!id) { logger.debug('Skipping job with missing id'); continue }
      resources.push({ id, type: 'job', name: String(job.name ?? ''), raw: normalizeRemoteRaw('job', job) })
    }
  } catch (err) { logFetchError('jobs', err) }

  try {
    const tests = await fetchAllPages<Record<string, unknown>>(client, '/api/tests?includeScript=true', 'tests')
    for (const test of tests) {
      const id = safeId(test.id)
      if (!id) { logger.debug('Skipping test with missing id'); continue }
      resources.push({ id, type: 'test', name: String(test.title ?? ''), raw: normalizeRemoteRaw('test', test) })
    }
  } catch (err) { logFetchError('tests', err) }

  try {
    const monitors = await fetchAllPages<Record<string, unknown>>(client, '/api/monitors', 'monitors')
    for (const monitor of monitors) {
      const id = safeId(monitor.id)
      if (!id) { logger.debug('Skipping monitor with missing id'); continue }
      resources.push({ id, type: 'monitor', name: String(monitor.name ?? ''), raw: normalizeRemoteRaw('monitor', monitor) })
    }
  } catch (err) { logFetchError('monitors', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/variables')
    for (const v of data) {
      const id = safeId(v.id)
      if (!id) { logger.debug('Skipping variable with missing id'); continue }
      // File-type variables are managed via the dashboard (multipart upload)
      // and cannot be deployed via the JSON API, so skip them during reconciliation.
      if (v.type === 'file') { continue }
      resources.push({ id, type: 'variable', name: String(v.key ?? ''), raw: normalizeRemoteRaw('variable', v) })
    }
  } catch (err) { logFetchError('variables', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/tags')
    for (const t of data) {
      const id = safeId(t.id)
      if (!id) { logger.debug('Skipping tag with missing id'); continue }
      resources.push({ id, type: 'tag', name: String(t.name ?? ''), raw: normalizeRemoteRaw('tag', t) })
    }
  } catch (err) { logFetchError('tags', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/notification-providers')
    for (const provider of data) {
      const id = safeId(provider.id)
      if (!id) { logger.debug('Skipping notification provider with missing id'); continue }
      resources.push({
        id,
        type: 'notificationProvider',
        name: String(provider.name ?? ''),
        raw: normalizeRemoteRaw('notificationProvider', provider),
      })
    }
  } catch (err) { logFetchError('notification providers', err) }

  try {
    const statusPages = await fetchAllPages<Record<string, unknown>>(client, '/api/status-pages', 'status-pages')
    for (const sp of statusPages) {
      const id = safeId(sp.id)
      if (!id) { logger.debug('Skipping status page with missing id'); continue }
      resources.push({ id, type: 'statusPage', name: String(sp.name ?? ''), raw: normalizeRemoteRaw('statusPage', sp) })
    }
  } catch (err) { logFetchError('status-pages', err) }

  return resources
}

/**
 * Log fetch errors with appropriate severity.
 * 404s are debug-level (resource type may not be enabled), other errors are warnings.
 */
function logFetchError(resourceType: string, err: unknown): void {
  if (err instanceof ApiRequestError && err.statusCode === 404) {
    logger.debug(`Could not fetch ${resourceType} (not found / disabled)`)
  } else {
    const msg = err instanceof Error ? err.message : String(err)
    logger.error(`Failed to fetch ${resourceType}: ${msg}`)
    throw err
  }
}

/**
 * Map resource type to the correct API endpoint.
 */
export function getApiEndpoint(type: string): string {
  switch (type) {
    case 'job': return '/api/jobs'
    case 'test': return '/api/tests'
    case 'monitor': return '/api/monitors'
    case 'variable': return '/api/variables'
    case 'tag': return '/api/tags'
    case 'notificationProvider': return '/api/notification-providers'
    case 'statusPage': return '/api/status-pages'
    default: throw new Error(`Unknown resource type: ${type}`)
  }
}

/**
 * Safe token preview that handles short tokens gracefully.
 * Returns a masked version suitable for user-facing log output.
 */
export function safeTokenPreview(token: string): string {
  if (!token || token.length === 0) return '(empty)'
  if (token.length <= 4) return `${token.substring(0, 1)}***`
  if (token.length <= 8) {
    return `${token.substring(0, 4)}...`
  }
  if (token.length <= 20) {
    // Show only the prefix (e.g. sck_live_) + a few chars
    return `${token.substring(0, Math.min(token.length - 4, 12))}...`
  }
  return `${token.substring(0, 12)}...${token.substring(token.length - 4)}`
}
