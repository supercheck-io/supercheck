import { discoverFiles, matchGlob } from '../utils/discovery.js'
import { managedState, verifyContext } from '../utils/managed.js'
import { getOutputFormat } from '../output/formatter.js'
import { randomUUID } from 'node:crypto'
import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { tryLoadConfig } from '../config/loader.js'
import { getStoredBaseUrl, getStoredOrganization, getStoredProject } from '../auth/store.js'
import { logger } from '../utils/logger.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode, ApiRequestError } from '../utils/errors.js'
import { fetchAllPages, fetchRemoteRequirements, fetchStatusPagesWithComponents, type RemoteRequirement } from '../utils/resources.js'
import { statusPageToDefinition } from '../utils/status-pages.js'
import { detectPackageManager, ensurePackageJson, installDependencies } from '../utils/package-manager.js'
import { extractUuidFromFilename, setScriptMetadata } from '../utils/slug.js'
import { isUuid, resolveWithin, testRelativePath, testTypeToFolder } from '../utils/paths.js'
import { decodeStoredTestScript } from '../utils/script.js'
import { redact } from '../utils/redact.js'

import pc from '../utils/colors.js'
import type { ApiClient } from '../api/client.js'

// ────────────────────────────────────────────────────────────────
// Types for fetched remote resources
// ────────────────────────────────────────────────────────────────

interface RemoteTest {
  id: string
  title: string
  description?: string
  type: string // 'browser' | 'performance' | 'api' etc.
  priority?: string
  script?: string
  tags?: Array<{ id: string; name: string; color?: string }>
  createdAt?: string
  updatedAt?: string
}

interface RemoteMonitor {
  id: string
  name: string
  description?: string
  type: string // 'http_request' | 'website' | 'ping_host' | 'port_check' | 'synthetic_test'
  target?: string
  frequencyMinutes?: number
  enabled?: boolean
  status?: string
  config?: Record<string, unknown>
  alertConfig?: Record<string, unknown>
  tags?: Array<{ id: string; name: string; color?: string }>
  organizationId?: string
  projectId?: string
  createdAt?: string
  updatedAt?: string
}

interface RemoteJob {
  id: string
  name: string
  description?: string
  jobType?: string
  cronSchedule?: string
  status?: string
  alertConfig?: Record<string, unknown>
  tests?: Array<{ id: string; title?: string; type?: string }>
  lastRunAt?: string
  nextRunAt?: string
  createdAt?: string
  updatedAt?: string
}

interface RemoteVariable {
  id: string
  key: string
  value?: string
  type: 'variable' | 'secret' | 'file'
  isSecret: boolean
  description?: string | null
  fileName?: string | null
  fileSize?: number | null
  mimeType?: string | null
}

interface RemoteTag {
  id: string
  name: string
  color?: string
}

/** Status page row (settings) plus, when the server supports it, its components. */
type RemoteStatusPage = Record<string, unknown> & { id: string; name: string; status?: string; components?: Array<Record<string, unknown>> }

interface RemoteNotificationProvider {
  id: string
  name: string
  type: string
  config: Record<string, unknown>
  maskedFields?: string[]
}

interface RemoteContext {
  organization: { id: string; name: string | null; slug: string | null }
  project: { id: string; name: string; slug: string | null; isDefault: boolean }
}

interface PullSummary {
  tests: number
  monitors: number
  jobs: number
  variables: number
  tags: number
  notificationProviders: number
  statusPages: number
  requirements: number
  skipped: number
  files: string[]
  backups: string[]
  errors: string[]
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Map API test type back to user-facing type name.
 */
function mapTestType(apiType: string): 'playwright' | 'k6' {
  if (apiType === 'performance' || apiType === 'k6') return 'k6'
  return 'playwright'
}

// testFilename and extractUuidFromFilename are imported from '../utils/slug.js'

/**
 * Write a file only if the content has changed, avoiding unnecessary git diffs.
 * Returns true if the file was written (new or changed), false if unchanged.
 */
function writeIfChanged(filePath: string, content: string, summary?: PullSummary): boolean {
  resolveWithin(process.cwd(), filePath)
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8')
    if (existing === content) return false
    const backup = `${filePath}.supercheck-backup.${randomUUID()}`
    writeFileSync(backup, existing, { mode: 0o600, flag: 'wx' })
    summary?.backups.push(backup)
  }

  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, content, 'utf-8')
  summary?.files.push(filePath)
  return true
}

function decodeScript(script: string | undefined): string | null {
  return decodeStoredTestScript(script)
}

// ────────────────────────────────────────────────────────────────
// Fetch functions
// ────────────────────────────────────────────────────────────────

async function fetchContext(client: ApiClient): Promise<RemoteContext> {
  const { data } = await client.get<{ success: boolean } & RemoteContext>('/api/context')
  if (!data?.organization?.id || !data?.project?.id) throw new CLIError('Invalid project context. No files were written.', ExitCode.ApiError)
  return data
}

async function fetchTests(client: ApiClient): Promise<RemoteTest[]> {
  try {
    const tests = await fetchAllPages<RemoteTest>(client, '/api/tests', 'tests')
    // IDs are used to build local file paths; reject the whole pull before any file is written.
    const invalid = tests.find((test) => !isUuid(test.id))
    if (invalid) throw new CLIError('Server returned a test with an invalid ID. No files were written.', ExitCode.ApiError)
    return tests
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchMonitors(client: ApiClient): Promise<RemoteMonitor[]> {
  try {
    return await fetchAllPages<RemoteMonitor>(client, '/api/monitors', 'monitors')
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchJobs(client: ApiClient): Promise<RemoteJob[]> {
  try {
    return await fetchAllPages<RemoteJob>(client, '/api/jobs', 'jobs')
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchVariables(client: ApiClient): Promise<RemoteVariable[]> {
  try {
    const { data } = await client.get<RemoteVariable[]>('/api/variables')
    return data
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchTags(client: ApiClient): Promise<RemoteTag[]> {
  try {
    const { data } = await client.get<RemoteTag[]>('/api/tags')
    return data
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchNotificationProviders(client: ApiClient): Promise<RemoteNotificationProvider[]> {
  try {
    const { data } = await client.get<RemoteNotificationProvider[]>('/api/notification-providers')
    return data
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchStatusPages(client: ApiClient): Promise<RemoteStatusPage[]> {
  let warned = false
  try {
    return await fetchStatusPagesWithComponents(client, () => {
      if (warned) return
      warned = true
      logger.warn('This server does not expose status page components; they are omitted from the pulled config.')
    }) as RemoteStatusPage[]
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

async function fetchRequirements(client: ApiClient): Promise<RemoteRequirement[]> {
  try {
    return await fetchRemoteRequirements(client)
  } catch (err) {
    if (err instanceof ApiRequestError && err.statusCode === 404) return []
    throw err
  }
}

// ────────────────────────────────────────────────────────────────
// Writers — write remote resources to local files
// ────────────────────────────────────────────────────────────────

/**
 * Pull test scripts into _supercheck_/ directory.
 * Each test is saved as a {slug}.{uuid}.pw.ts or {slug}.{uuid}.k6.ts file.
 */
class IdentityMismatch extends CLIError {
  constructor(message: string) { super(message, ExitCode.ApiError) }
}

export function pullTests(tests: RemoteTest[], cwd: string, summary: PullSummary, managedPaths = new Map<string, string>(), obsoletePaths = new Map<string, string>()): void {
  const baseDir = resolve(cwd, '_supercheck_')
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }

  // Build a map of existing UUID → filename for rename detection.
  // When a test is renamed on the server, we replace the old file
  // (with the old slug) instead of leaving an orphan.
  const existingByUuid = new Map<string, string>()
  try {
    for (const folder of ['playwright', 'k6']) {
      const folderPath = resolve(baseDir, folder)
      if (!existsSync(folderPath)) continue
      for (const file of readdirSync(folderPath)) {
        const uuid = extractUuidFromFilename(file)
        if (uuid) existingByUuid.set(uuid, `_supercheck_/${folder}/${file}`)
      }
    }
  } catch {
    // Directory may not exist yet — that's fine
  }

  for (const [id, path] of obsoletePaths) existingByUuid.set(id, path)

  for (const test of tests) {
    try {
      const testType = mapTestType(test.type)
      const relPath = managedPaths.get(test.id) ?? testRelativePath(test.id, test.title, testType)
      const folderPath = resolve(baseDir, testTypeToFolder(testType))
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      let script = decodeScript(test.script)
      if (!script) {
        logger.debug(`Skipping test "${test.title}" — no script content`)
        summary.skipped++
        continue
      }

      // Inject/Update @title, @priority and @tags metadata so the local file round-trips the test's fields.
      // Prefer JSDoc injection if a block exists, otherwise use single-line comments.
      script = setScriptMetadata(script, 'title', test.title)
      if (test.priority) script = setScriptMetadata(script, 'priority', test.priority)
      const tagNames = (test.tags ?? []).map((tag) => tag.name).sort()
      if (tagNames.length > 0) script = setScriptMetadata(script, 'tags', tagNames.join(', '))

      // Clean up old file if UUID exists but filename changed (e.g., test renamed)
      const existingFilename = existingByUuid.get(test.id)
      const currentFile = relPath
      const filePath = resolveWithin(cwd, relPath)
      const written = writeIfChanged(filePath, script, summary)

      if (existingFilename && existingFilename !== currentFile) {
        const oldPath = resolveWithin(cwd, existingFilename)
        if (existsSync(oldPath)) {
          const backup = `${oldPath}.supercheck-backup.${randomUUID()}`
          writeFileSync(backup, readFileSync(oldPath), { mode: 0o600, flag: 'wx' })
          summary.backups.push(backup)
          unlinkSync(oldPath)
        }
      }
      if (written) {
        logger.info(pc.green(`  + ${relPath}`))
        summary.tests++
      } else {
        logger.debug(`  = ${relPath} (unchanged)`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.errors.push(`test "${test.title}": ${msg}`)
    }
  }
}

/**
 * Build monitor definitions from remote data.
 * Produces a clean config by removing defaults and runtime-only fields
 * while keeping field names compatible with the API for round-trip support.
 */
export function buildMonitorDefinitions(
  monitors: RemoteMonitor[],
): Record<string, unknown>[] {
  return monitors.map((m) => {
    const def: Record<string, unknown> = {
      id: m.id,
      name: m.name,
      type: m.type,
    }

    if (m.description) def.description = m.description
    if (m.target) def.target = m.target
    // Read-only tokens receive targets with credentials replaced by REDACTED
    if (m.target && /\/\/REDACTED@|[?&][^=&]*=REDACTED(?:&|#|$)/.test(m.target)) {
      logger.warn(`Monitor "${m.name}" target has redacted credentials (insufficient permission); do not deploy this value`)
    }
    if (m.frequencyMinutes !== undefined) def.frequencyMinutes = m.frequencyMinutes
    if (m.enabled !== undefined) def.enabled = m.enabled
    if (m.tags && m.tags.length > 0) def.tags = m.tags.map((tag) => tag.name).sort()

    // Pass config through, stripping only runtime/default noise
    if (m.config && typeof m.config === 'object') {
      const config = { ...m.config } as Record<string, unknown>

      // Remove runtime-only fields
      delete config.sslLastCheckedAt
      delete config.aggregatedAlertState

      // Clean up default playwrightOptions (retries:0, timeout:300000, headless:true)
      if (config.playwrightOptions && typeof config.playwrightOptions === 'object') {
        const opts = { ...(config.playwrightOptions as Record<string, unknown>) }
        if (opts.retries === 0) delete opts.retries
        if (opts.timeout === 300000) delete opts.timeout
        if (opts.headless === true) delete opts.headless
        config.playwrightOptions = Object.keys(opts).length > 0 ? opts : undefined
        if (!config.playwrightOptions) delete config.playwrightOptions
      }

      // Clean up locationConfig: remove defaults, drop if empty/disabled
      if (config.locationConfig && typeof config.locationConfig === 'object') {
        const loc = { ...(config.locationConfig as Record<string, unknown>) }
        const hasLocations = Array.isArray(loc.locations) && (loc.locations as string[]).length > 0
        if (!loc.enabled || !hasLocations) {
          // Disabled or no locations — remove entirely
          delete config.locationConfig
        } else {
          // Remove default values to reduce noise
          if (loc.enabled === true) delete loc.enabled
          if (loc.strategy === 'majority') delete loc.strategy
          if (loc.threshold === 50) delete loc.threshold
          config.locationConfig = Object.keys(loc).length > 0 ? loc : undefined
          if (!config.locationConfig) delete config.locationConfig
        }
      }

      if (Object.keys(config).length > 0) def.config = config
    }

    // Pass alertConfig through, stripping only defaults
    if (m.alertConfig && typeof m.alertConfig === 'object') {
      const alert = { ...m.alertConfig } as Record<string, unknown>

      // Remove empty/default values
      if (alert.customMessage === '' || alert.customMessage === null) delete alert.customMessage
      if (alert.failureThreshold === 1) delete alert.failureThreshold
      if (alert.recoveryThreshold === 1) delete alert.recoveryThreshold

      // Remove false boolean flags (they're defaults)
      for (const key of ['alertOnFailure', 'alertOnRecovery', 'alertOnSslExpiration', 'alertOnSuccess', 'alertOnTimeout']) {
        if (alert[key] === false) delete alert[key]
      }

      // Remove empty notificationProviders array
      if (Array.isArray(alert.notificationProviders) && (alert.notificationProviders as string[]).length === 0) {
        delete alert.notificationProviders
      }

      if (Object.keys(alert).length > 0) def.alertConfig = alert
    }

    const masked = redact(def)
    if (JSON.stringify(masked) !== JSON.stringify(def)) logger.warn(`Monitor "${m.name}" credentials were redacted; restore them securely before deploying.`)
    return masked
  })
}

/**
 * Build job definitions from remote data.
 * testMap resolves test UUIDs to file paths for human-readable references.
 * Omits runtime state (status) and cleans up alertConfig defaults.
 */
function buildJobDefinitions(
  jobs: RemoteJob[],
  testMap: Map<string, string>,
): Record<string, unknown>[] {
  return jobs.map((j) => {
    const def: Record<string, unknown> = {
      id: j.id,
      name: j.name,
      tests: (j.tests ?? []).map((t) => {
        // Resolve test UUID to file path if available, otherwise keep UUID
        return testMap.get(t.id) ?? t.id
      }),
    }

    if (j.description) def.description = j.description
    if (j.jobType) def.jobType = j.jobType
    if (j.cronSchedule) def.cronSchedule = j.cronSchedule
    // Note: `status` is intentionally omitted — it's runtime state, not config

    // Pass alertConfig through, stripping only defaults
    if (j.alertConfig && typeof j.alertConfig === 'object') {
      const alert = { ...j.alertConfig } as Record<string, unknown>

      // Remove empty/default values
      if (alert.customMessage === '' || alert.customMessage === null) delete alert.customMessage
      if (alert.failureThreshold === 1) delete alert.failureThreshold
      if (alert.recoveryThreshold === 1) delete alert.recoveryThreshold

      // Remove false boolean flags (they're defaults)
      for (const key of ['alertOnFailure', 'alertOnRecovery', 'alertOnSslExpiration', 'alertOnSuccess', 'alertOnTimeout']) {
        if (alert[key] === false) delete alert[key]
      }

      // Remove empty notificationProviders array
      if (Array.isArray(alert.notificationProviders) && (alert.notificationProviders as string[]).length === 0) {
        delete alert.notificationProviders
      }

      if (Object.keys(alert).length > 0) def.alertConfig = alert
    }

    return def
  })
}

/**
 * A reference to a local environment variable in the generated config. Only code we construct can create one;
 * server-supplied strings that merely look like `${NAME}` are always emitted as literals.
 */
class EnvRef {
  constructor(readonly name: string) {}
}

// A secret variable's key is chosen on the server, and the pulled config reads the local environment variable of the
// same name. Refuse names that could point at the user's own credentials or CI runtime, so a project member cannot
// name a secret AWS_SECRET_ACCESS_KEY and have a later deploy send that value back.
const SAFE_ENV_NAME = /^[A-Z][A-Z0-9_]*$/
const RESERVED_ENV_NAME = /^(?:SUPERCHECK_|AWS_|AZURE_|GCP_|GOOGLE_|GITHUB_|GH_|GITLAB_|CI_|ACTIONS_|RUNNER_|NPM_|NODE_|YARN_|PNPM_|DOCKER_|KUBE|SSH_|GPG_|PG|POSTGRES|MYSQL|MONGO|REDIS|TWINE_|PYPI_|CARGO_|OPENAI_|ANTHROPIC_|HOME$|PATH$|USER$|SHELL$|DATABASE_URL$|DB_URL$)/
export function isSafeEnvReferenceName(name: string): boolean {
  return SAFE_ENV_NAME.test(name) && !RESERVED_ENV_NAME.test(name)
}

/**
 * Build variable definitions from remote data.
 * Secret values are never written to config.
 */
export function buildVariableDefinitions(variables: RemoteVariable[]): Record<string, unknown>[] {
  // File-type variables are managed via the dashboard (multipart upload).
  // They cannot be round-tripped via config, so exclude them.
  const configVariables = variables.filter((v) => v.type !== 'file')

  return configVariables.map((v) => {
    const def: Record<string, unknown> = {
      id: v.id,
      key: v.key,
      isSecret: v.isSecret,
    }

    if (v.description) def.description = v.description

    if (v.isSecret) {
      // SECURITY: Never write secret values to config files.
      // Use environment variables or `supercheck var set` for secret values.
      const envVarName = v.key.toUpperCase()
      if (isSafeEnvReferenceName(envVarName)) def.value = new EnvRef(envVarName)
      else {
        logger.warn(`Secret variable "${v.key}" cannot be linked to an environment variable automatically; set its value with \`supercheck var set\`.`)
        def.value = ''
      }
    } else {
      def.value = v.value ?? ''
    }

    return def
  })
}

/**
 * Build tag definitions from remote data.
 */
function buildTagDefinitions(tags: RemoteTag[]): Record<string, unknown>[] {
  return tags.map((t) => {
    const def: Record<string, unknown> = {
      id: t.id,
      name: t.name,
    }
    if (t.color) def.color = t.color
    return def
  })
}

/**
 * Build notification provider definitions from remote data.
 *
 * Secret fields returned by the API as masked values are stripped from the
 * pulled config so they are never committed to version control. The server
 * preserves existing secret values when a deploy omits them, so non-secret
 * edits (e.g. bodyTemplate) can still be round-tripped safely.
 */
export function buildNotificationProviderDefinitions(providers: RemoteNotificationProvider[]): Record<string, unknown>[] {
  return providers.map((provider) => {
    const config: Record<string, unknown> = { ...(provider.config || {}) }
    const maskedFields = Array.isArray(provider.maskedFields)
      ? provider.maskedFields.filter((field): field is string => typeof field === 'string')
      : []

    // SECURITY: Never write masked (secret) values to config files.
    for (const field of maskedFields) {
      delete config[field]
    }

    // Keep config.name in sync with the top-level name for stable round-trip diffs.
    config.name = provider.name

    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      config,
    }
  })
}

/**
 * Build status page definitions from remote data: settings, branding, subscriber flags and components.
 * Uses the same mapping as remote normalization so pull -> diff reports no changes.
 * `subdomain` is written for reference only; it is server-generated and never deployed.
 */
export function buildStatusPageDefinitions(pages: RemoteStatusPage[]): Record<string, unknown>[] {
  return pages.map((p) => {
    const def = statusPageToDefinition(p, p.components)
    if (def.language === 'en') delete def.language
    return def
  })
}

/**
 * Build requirement definitions. `testMap` resolves test UUIDs to file paths like job references do.
 */
export function buildRequirementDefinitions(
  requirements: RemoteRequirement[],
  testMap: Map<string, string>,
): Record<string, unknown>[] {
  return requirements.map((r) => {
    const def: Record<string, unknown> = { id: r.id, title: r.title }
    if (r.description) def.description = r.description
    if (r.priority) def.priority = r.priority
    const tags = (r.tags ?? []).map((tag) => (typeof tag === 'string' ? tag : String(tag.name ?? ''))).filter(Boolean).sort()
    if (tags.length > 0) def.tags = tags
    if (r.externalId) def.externalId = r.externalId
    if (r.externalUrl) def.externalUrl = r.externalUrl
    const tests = [...new Set(r.testIds ?? [])].sort().map((id) => testMap.get(id) ?? id)
    if (tests.length > 0) def.tests = tests
    return def
  })
}

// ────────────────────────────────────────────────────────────────
// Config generator
// ────────────────────────────────────────────────────────────────

/**
 * Generate a supercheck.config.ts file from pulled remote resources.
 */
export function generateConfigContent(opts: {
  orgId: string
  projectId: string
  baseUrl: string
  monitors: Record<string, unknown>[]
  jobs: Record<string, unknown>[]
  variables: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  notificationProviders: Record<string, unknown>[]
  statusPages: Record<string, unknown>[]
  requirements?: Record<string, unknown>[]
  tests?: { playwright?: { testMatch?: string; browser?: string }; k6?: { testMatch?: string } }
}): string {
  const parts: string[] = []

  parts.push(`import { defineConfig } from '@supercheck/cli'`)
  parts.push('')
  parts.push('export default defineConfig({')
  parts.push(`  schemaVersion: '1.0',`)
  parts.push('')

  // Project
  parts.push('  // Project identifiers — found in Dashboard > Project Settings')
  parts.push('  project: {')
  parts.push(`    organization: ${JSON.stringify(opts.orgId)},`)
  parts.push(`    project: ${JSON.stringify(opts.projectId)},`)
  parts.push('  },')
  parts.push('')

  // API
  parts.push('  // API connection — set SUPERCHECK_URL env var for self-hosted or staging')
  parts.push('  api: {')
  parts.push(`    baseUrl: process.env.SUPERCHECK_URL ?? ${JSON.stringify(opts.baseUrl)},`)
  parts.push('  },')
  parts.push('')

  // Tests
  parts.push('  // Test file patterns — Playwright (.pw.ts) and k6 (.k6.ts) scripts')
  parts.push('  tests: {')
  parts.push('    playwright: {')
  parts.push(`      testMatch: ${JSON.stringify(opts.tests?.playwright?.testMatch ?? '_supercheck_/playwright/**/*.pw.ts')},`)
  parts.push(`      browser: ${JSON.stringify(opts.tests?.playwright?.browser ?? 'chromium')},`)
  parts.push('    },')
  parts.push('    k6: {')
  parts.push(`      testMatch: ${JSON.stringify(opts.tests?.k6?.testMatch ?? '_supercheck_/k6/**/*.k6.ts')},`)
  parts.push('    },')
  parts.push('  },')

  // Monitors
  if (opts.monitors.length > 0) {
    parts.push('')
    parts.push('  // Monitors — uptime checks, HTTP requests, synthetic tests')
    parts.push(`  monitors: ${formatArray(opts.monitors, 2)},`)
  }

  // Jobs
  if (opts.jobs.length > 0) {
    parts.push('')
    parts.push('  // Jobs — scheduled or triggered test execution groups')
    parts.push(`  jobs: ${formatArray(opts.jobs, 2)},`)
  }

  // Requirements
  if (opts.requirements && opts.requirements.length > 0) {
    parts.push('')
    parts.push('  // Requirements — what the product must do, linked to the tests that cover them')
    parts.push(`  requirements: ${formatArray(opts.requirements, 2)},`)
  }

  // Variables
  if (opts.variables.length > 0) {
    parts.push('')
    parts.push('  // Variables — key-value pairs available to tests at runtime')
    parts.push('  // Secret values use process.env references — set them in your shell or CI/CD')
    parts.push(`  variables: ${formatArray(opts.variables, 2)},`)
  }

  // Tags
  if (opts.tags.length > 0) {
    parts.push('')
    parts.push('  // Tags — labels for organizing tests, monitors, and jobs')
    parts.push(`  tags: ${formatArray(opts.tags, 2)},`)
  }

  // Notification Providers
  if (opts.notificationProviders.length > 0) {
    parts.push('')
    parts.push('  // Notification Providers — alert destinations and webhook body templates')
    parts.push(`  notificationProviders: ${formatArray(opts.notificationProviders, 2)},`)
  }

  // Status Pages
  if (opts.statusPages.length > 0) {
    parts.push('')
    parts.push('  // Status Pages — public dashboards showing monitor health')
    parts.push(`  statusPages: ${formatArray(opts.statusPages, 2)},`)
  }

  parts.push('})')
  parts.push('')

  // Footer comment with getting started guide and CLI commands
  parts.push('/**')
  parts.push(' * Supercheck — Getting Started')
  parts.push(' * ────────────────────────────────────────────────────────────────')
  parts.push(' *')
  parts.push(' * This file was generated by `supercheck pull`. It is the source of truth')
  parts.push(' * for your Supercheck project configuration.')
  parts.push(' *')
  parts.push(' * Getting Started:')
  parts.push(' *   1. Install dependencies:')
  parts.push(' *        npm install -D @supercheck/cli typescript @types/node')
  parts.push(' *        # If using Playwright tests, also install:')
  parts.push(' *        npm install -D @playwright/test')
  parts.push(' *        # If using k6 tests, also install types and k6 runtime:')
  parts.push(' *        npm install -D @types/k6')
  parts.push(' *        # Install k6 runtime: https://grafana.com/docs/k6/latest/set-up/install-k6/')
  parts.push(' *')
  parts.push(' *   2. Review the configuration above and make any changes you need.')
  parts.push(' *   3. Preview what will change:  npx supercheck diff')
  parts.push(' *   4. Deploy your changes:       npx supercheck deploy')
  parts.push(' *   5. Re-sync from cloud:        npx supercheck pull')
  parts.push(' *')
  parts.push(' * CLI Commands:')
  parts.push(' *   supercheck pull               Pull remote config & test scripts to local')
  parts.push(' *   supercheck diff               Compare local config vs remote')
  parts.push(' *   supercheck deploy              Deploy local config to the cloud')
  parts.push(' *   supercheck destroy             Remove all managed resources from the cloud')
  parts.push(' *')
  parts.push(' *   supercheck test list           List all tests')
  parts.push(' *   supercheck test validate       Validate a local test script')
  parts.push(' *   supercheck test run            Run local test scripts')
  parts.push(' *')
  parts.push(' *   supercheck monitor list        List all monitors')
  parts.push(' *   supercheck job list            List all jobs')
  parts.push(' *   supercheck job run --id <id>   Run a job immediately')
  parts.push(' *')
  parts.push(' *   supercheck config validate     Validate this config file')
  parts.push(' *   supercheck health              Check API connectivity')
  parts.push(' *   supercheck whoami              Show current authentication info')
  parts.push(' *')
  parts.push(' * CI/CD Integration:')
  parts.push(' *   Set the SUPERCHECK_TOKEN environment variable in your CI/CD pipeline')
  parts.push(' *   and run `supercheck deploy` to push changes automatically.')
  parts.push(' *')
  parts.push(` * Documentation: https://supercheck.io/docs/app/welcome`)
  parts.push(' */')
  parts.push('')

  return parts.join('\n')
}

/**
 * Format an array of objects as indented TypeScript-like syntax.
 */
function formatArray(arr: Record<string, unknown>[], baseIndent: number): string {
  const indent = '  '.repeat(baseIndent)
  const innerIndent = '  '.repeat(baseIndent + 1)

  if (arr.length === 0) return '[]'

  const items = arr.map((obj) => {
    const fields = Object.entries(obj)
      .map(([key, value]) => `${innerIndent}  ${formatConfigKey(key)}: ${formatValue(value, baseIndent + 2)},`)
      .join('\n')
    return `${innerIndent}{\n${fields}\n${innerIndent}}`
  })

  return `[\n${items.join(',\n')}\n${indent}]`
}

function formatConfigKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) && key !== '__proto__'
    ? key
    : `[${JSON.stringify(key)}]`
}

/**
 * Format a value for TypeScript source output.
 * Produces clean, readable TS syntax (not JSON.stringify).
 */
function formatValue(value: unknown, indent = 0): string {
  if (value instanceof EnvRef) {
    // Bracket notation for names that aren't valid JS identifiers (dashes, dots, spaces, leading digits).
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value.name) ? `process.env.${value.name} ?? ''` : `process.env[${JSON.stringify(value.name)}] ?? ''`
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((v) => typeof v === 'string')) {
      return `[${value.map((v) => JSON.stringify(v)).join(', ')}]`
    }
    // Array of objects or mixed
    const innerIndent = '  '.repeat(indent + 1)
    const items = value.map((v) => `${innerIndent}${formatValue(v, indent + 1)}`)
    return `[\n${items.join(',\n')}\n${'  '.repeat(indent)}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const innerIndent = '  '.repeat(indent + 1)
    const fields = entries
      .map(([key, v]) => `${innerIndent}${formatConfigKey(key)}: ${formatValue(v, indent + 1)}`)
      .join(',\n')
    return `{\n${fields},\n${'  '.repeat(indent)}}`
  }
  return String(value)
}

// ────────────────────────────────────────────────────────────────
// Pull Command
// ────────────────────────────────────────────────────────────────

export const pullCommand = new Command('pull')
  .description('Copy remote tests and config into the local project; preserve local-only test scripts')
  .option('--config <path>', 'Path to config file')
  .option('--force', 'Bypass confirmation prompt before overwriting local files')
  .option('--tests-only', 'Only pull test scripts')
  .option('--config-only', 'Only pull config (monitors, jobs, requirements, notification providers, variables, tags, status pages)')
  .option('--skip-install', 'Do not install dependencies when initializing a project')
  .option('--dry-run', 'Show what would be pulled without writing files')
  .action(async (options: {
    config?: string
    force?: boolean
    testsOnly?: boolean
    configOnly?: boolean
    skipInstall?: boolean
    dryRun?: boolean
  }) => {
    // Validate mutually exclusive flags
    if (options.testsOnly && options.configOnly) {
      throw new CLIError(
        '--tests-only and --config-only are mutually exclusive. Use one or neither.',
        ExitCode.ConfigError,
      )
    }

    const cwd = process.cwd()

    // Try loading existing config for baseUrl context
    const existing = await tryLoadConfig({ cwd, configPath: options.config })
    if (!options.testsOnly) resolveWithin(cwd, existing?.configPath ?? options.config ?? 'supercheck.config.ts')

    const client = createAuthenticatedClient(existing?.config?.api?.baseUrl)

    logger.newline()
    logger.header('Pulling from Supercheck cloud...')
    logger.newline()

    if (existing) await verifyContext(client, existing.config, true, existing.declaredBaseUrl)

    // ── Fetch project/org context and all remote resources in parallel ──
    const [context, tests, monitors, jobs, variables, tags, notificationProviders, statusPages, requirements] = await withSpinner(
      'Fetching remote resources...',
      async () => {
        const results = await Promise.all([
          fetchContext(client),
          options.configOnly ? Promise.resolve([]) : fetchTests(client),
          options.testsOnly ? Promise.resolve([]) : fetchMonitors(client),
          options.testsOnly ? Promise.resolve([]) : fetchJobs(client),
          options.testsOnly ? Promise.resolve([]) : fetchVariables(client),
          options.testsOnly ? Promise.resolve([]) : fetchTags(client),
          options.testsOnly ? Promise.resolve([]) : fetchNotificationProviders(client),
          options.testsOnly ? Promise.resolve([]) : fetchStatusPages(client),
          options.testsOnly ? Promise.resolve([]) : fetchRequirements(client),
        ])
        return results as [RemoteContext, RemoteTest[], RemoteMonitor[], RemoteJob[], RemoteVariable[], RemoteTag[], RemoteNotificationProvider[], RemoteStatusPage[], RemoteRequirement[]]
      },
      { successText: 'Fetched remote resources' },
    )

    const managedPaths = new Map<string, string>()
    const obsoletePaths = new Map<string, string>()
    if (existing) {
      const state = managedState(client, context, existing.configPath)
      const patterns = { playwright: existing.config.tests?.playwright?.testMatch, k6: existing.config.tests?.k6?.testMatch }
      for (const file of discoverFiles(cwd, patterns)) {
        const name = file.relativePath.replace(/^_supercheck_\//, '')
        try {
          const id = state.resolve('test', name)
          const remote = tests.find((test) => test.id === id)
          if (remote && mapTestType(remote.type) !== file.type) obsoletePaths.set(id, file.relativePath)
          else managedPaths.set(id, file.relativePath)
        } catch (error) {
          if (!(error instanceof CLIError) || !error.message.startsWith('Unresolved test reference')) throw error
        }
      }
    }
    for (const test of tests) {
      if (managedPaths.has(test.id)) continue
      const type = mapTestType(test.type)
      const defaultPath = testRelativePath(test.id, test.title, type)
      const pattern = existing?.config.tests?.[type]?.testMatch
      if (!pattern || matchGlob(defaultPath, pattern)) { managedPaths.set(test.id, defaultPath); continue }
      const prefix = pattern.split('/').slice(0, pattern.split('/').findIndex((part) => /[*?]/.test(part))).join('/')
      let filename = defaultPath.split('/').pop()!
      if (type === 'playwright' && pattern.endsWith('.spec.ts')) filename = filename.replace(/\.pw\.ts$/, '.spec.ts')
      const candidate = [prefix, filename].filter(Boolean).join('/')
      if (!matchGlob(candidate, pattern)) throw new CLIError(`Cannot import test into custom pattern "${pattern}". Use a compatible testMatch before pulling scripts. No files were written.`, ExitCode.ConfigError)
      managedPaths.set(test.id, candidate)
    }
    // A local testMatch can point outside the project; refuse up front, before any prompt or write.
    for (const path of [...managedPaths.values(), ...obsoletePaths.values()]) {
      try { resolveWithin(cwd, path) } catch { throw new CLIError(`Test path "${path}" resolves outside the project directory or through a symlink. No files were written.`, ExitCode.ConfigError) }
    }

    logger.debug(`Found: ${tests.length} tests, ${monitors.length} monitors, ${jobs.length} jobs, ${variables.length} variables, ${tags.length} tags, ${notificationProviders.length} notification providers, ${statusPages.length} status pages, ${requirements.length} requirements`)

    logger.info('Pull only copies remote resources to local files.')
    logger.info('Local-only test scripts are preserved; `supercheck deploy` can create them remotely. Run `supercheck diff` to preview.')

    const totalResources = tests.length + monitors.length + jobs.length + variables.length + tags.length + notificationProviders.length + statusPages.length + requirements.length
    if (totalResources === 0) {
      if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: 'no_change', context, files: [], backups: [], errors: [] }))
      logger.warn(options.testsOnly ? 'No test scripts found on the remote project.'
        : options.configOnly ? 'No config resources found on the remote project.'
          : 'No resources found on the remote project.')
      return
    }

    const resourceCounts = [
      tests.length > 0 ? `${tests.length} test script(s)` : '',
      monitors.length > 0 ? `${monitors.length} monitor(s)` : '',
      jobs.length > 0 ? `${jobs.length} job(s)` : '',
      variables.length > 0 ? `${variables.length} variable(s)` : '',
      tags.length > 0 ? `${tags.length} tag(s)` : '',
      notificationProviders.length > 0 ? `${notificationProviders.length} notification provider(s)` : '',
      statusPages.length > 0 ? `${statusPages.length} status page(s)` : '',
      requirements.length > 0 ? `${requirements.length} requirement(s)` : '',
    ].filter(Boolean)
    logger.info(`Found ${pc.bold(String(totalResources))} remote resource(s): ${resourceCounts.join(', ')}.`)
    if (options.configOnly) logger.info('Test scripts are excluded (--config-only).')
    else if (tests.length === 0) logger.info('No remote test scripts to pull.')

    const pkgPath = resolve(cwd, 'package.json')
    if (!options.skipInstall && !existsSync(pkgPath)) {
      resolveWithin(cwd, 'package.json')
      resolveWithin(cwd, 'tsconfig.supercheck.json')
    }
    const plannedFiles = [
      ...tests.map((test) => ({ path: resolve(cwd, managedPaths.get(test.id)!), kind: 'test', id: test.id })),
      ...(!options.testsOnly ? [{ path: existing?.configPath ?? resolve(cwd, options.config ?? 'supercheck.config.ts'), kind: 'config' }] : []),
    ].map((file) => ({ ...file, overwrite: existsSync(file.path) }))
    const preview = { status: 'preview', context, files: plannedFiles, installsDependencies: !options.skipInstall && !existsSync(pkgPath), preservesLocalOnlyScripts: true }

    const fileEffects: string[] = []
    if (tests.length > 0) fileEffects.push('write test scripts in _supercheck_ (overwriting matching local files)')
    if (!options.testsOnly) fileEffects.push('create or replace supercheck.config.ts (overwriting local config edits)')
    const effectPrefix = options.dryRun ? 'A pull would' : 'This will'
    logger.info(`${effectPrefix} ${fileEffects.join(' and ')}.`)
    if (!existsSync(pkgPath)) {
      logger.info(`${effectPrefix} also create package.json, install dependencies, and create tsconfig.supercheck.json if missing.`)
    }

    // ── Dry run summary ──
    if (options.dryRun) {
      logger.newline()
      logger.header('Resources that would be pulled:')
      logger.newline()

      if (tests.length > 0) {
        logger.info(pc.cyan(`  Tests (${tests.length}):`))
        for (const t of tests) {
          const testType = mapTestType(t.type)
          logger.info(`    ${t.title} (${testType})`)
        }
      }
      if (monitors.length > 0) {
        logger.info(pc.cyan(`  Monitors (${monitors.length}):`))
        for (const m of monitors) logger.info(`    ${m.name} (${m.type}, every ${m.frequencyMinutes ?? '?'}min)`)
      }
      if (jobs.length > 0) {
        logger.info(pc.cyan(`  Jobs (${jobs.length}):`))
        for (const j of jobs) logger.info(`    ${j.name}${j.cronSchedule ? ` (${j.cronSchedule})` : ''}`)
      }
      if (variables.length > 0) {
        logger.info(pc.cyan(`  Variables (${variables.length}):`))
        for (const v of variables) {
          const typeLabel = v.type === 'file' ? ' (file; skipped — managed via dashboard)' : v.type === 'secret' ? ' (secret)' : ''
          logger.info(`    ${v.key}${typeLabel}`)
        }
      }
      if (tags.length > 0) {
        logger.info(pc.cyan(`  Tags (${tags.length}):`))
        for (const t of tags) logger.info(`    ${t.name}`)
      }
      if (notificationProviders.length > 0) {
        logger.info(pc.cyan(`  Notification Providers (${notificationProviders.length}):`))
        for (const provider of notificationProviders) logger.info(`    ${provider.name} (${provider.type})`)
      }
      if (statusPages.length > 0) {
        logger.info(pc.cyan(`  Status Pages (${statusPages.length}):`))
        for (const sp of statusPages) logger.info(`    ${sp.name} (${sp.status ?? 'draft'})`)
      }
      if (requirements.length > 0) {
        logger.info(pc.cyan(`  Requirements (${requirements.length}):`))
        for (const r of requirements) logger.info(`    ${r.title}${r.priority ? ` (${r.priority})` : ''}`)
      }

      logger.newline()
      if (getOutputFormat() === 'json') logger.output(JSON.stringify(preview))
      logger.info(pc.yellow('Dry run — no files written.'))
      logger.newline()
      return
    }

    // ── Confirm if not --force ──
    if (!options.force) {
      logger.newline()

      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt('Continue?', { default: false, context, changes: plannedFiles })
      logger.newline()
    }

    const summary: PullSummary = {
      tests: 0,
      monitors: 0,
      jobs: 0,
      variables: 0,
      tags: 0,
      notificationProviders: 0,
      statusPages: 0,
      requirements: 0,
      skipped: 0,
      files: [],
      backups: [],
      errors: [],
    }

    // ── Pull test scripts ──
    if (!options.configOnly && tests.length > 0) {
      logger.header('Tests:')

      // For tests that need full script content, fetch individually
      // (list endpoint may not include script)
      const fullTests: RemoteTest[] = []
      for (const t of tests) {
        if (t.script) {
          fullTests.push(t)
        } else {
          // Fetch individual test to get the script
          try {
            const { data } = await withSpinner(
              `Fetching script for "${t.title}"`,
              () => client.get<RemoteTest>(
                `/api/tests/${t.id}`,
                { includeScript: 'true' },
              ),
            )
            if (data?.id !== t.id) throw new IdentityMismatch(`Server returned a different test than requested (${t.id}). No files were written.`)
            fullTests.push(data)
          } catch (err) {
            // A swapped response means the server is not trustworthy for this pull; abort instead of recording a partial failure.
            if (err instanceof IdentityMismatch) throw err
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`  Could not fetch script for "${t.title}": ${msg}`)
            summary.errors.push(`test "${t.title}": ${msg}`)
          }
        }
      }

      pullTests(fullTests, cwd, summary, managedPaths, obsoletePaths)
      logger.newline()
    }

    // ── Install dependencies if package.json is missing ──
    if (!options.dryRun && !options.skipInstall && !existsSync(pkgPath)) {
      logger.newline()
      logger.info('Initializing project dependencies...')

      const pm = detectPackageManager(cwd)
      ensurePackageJson(cwd)

      const packages = ['@supercheck/cli', 'typescript', '@types/node']

      // Auto-detect required test packages
      const hasPlaywright = tests.some(t => mapTestType(t.type) === 'playwright')
      const hasK6 = tests.some(t => mapTestType(t.type) === 'k6')

      if (hasPlaywright) packages.push('@playwright/test')
      if (hasK6) packages.push('@types/k6')

      await installDependencies(cwd, pm, {
        packages,
        skipInstall: false,
      })

      // Write tsconfig.supercheck.json for IDE IntelliSense if not present
      const tsconfigPath = resolve(cwd, 'tsconfig.supercheck.json')
      if (!existsSync(tsconfigPath)) {
        const tsconfigContent = JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            esModuleInterop: true,
            strict: true,
            skipLibCheck: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            types: ['node', ...(hasK6 ? ['k6'] : [])],
          },
          include: [
            'supercheck.config.ts',
            'supercheck.config.local.ts',
            '_supercheck_/**/*.ts',
          ],
        }, null, 2) + '\n'
        writeFileSync(tsconfigPath, tsconfigContent, 'utf-8')
        logger.success('Created tsconfig.supercheck.json (IDE IntelliSense)')
      }

      logger.success('Project initialized with dependencies')
    }

    // ── Build config from remote resources ──
    if (!options.testsOnly) {
      // Build a test ID -> file path map for job test references
      const testMap = new Map<string, string>(managedPaths)
      for (const t of tests) {
        const testType = mapTestType(t.type)
        const filePath = managedPaths.get(t.id) ?? testRelativePath(t.id, t.title, testType)
        testMap.set(t.id, filePath)
      }

      const monitorDefs = buildMonitorDefinitions(monitors)
      const jobDefs = buildJobDefinitions(jobs, testMap)
      const variableDefs = buildVariableDefinitions(variables)
      const tagDefs = buildTagDefinitions(tags)
      const notificationProviderDefs = buildNotificationProviderDefinitions(notificationProviders)
      const statusPageDefs = buildStatusPageDefinitions(statusPages)
      const requirementDefs = buildRequirementDefinitions(requirements, testMap)

      summary.monitors = monitors.length
      summary.jobs = jobs.length
      summary.variables = variableDefs.length
      summary.tags = tags.length
      summary.notificationProviders = notificationProviderDefs.length
      summary.statusPages = statusPages.length
      summary.requirements = requirements.length

      const fileVariableCount = variables.length - variableDefs.length
      if (fileVariableCount > 0) {
        logger.info(pc.dim(`  ${fileVariableCount} file variable(s) skipped (managed via dashboard)`))
      }

      // Resolve org/project identity — prefer context API, fall back to resource data.
      // Skip 'unknown-*' from previous broken pulls to avoid self-reinforcing fallback.
      const existingOrg = existing?.config?.project?.organization
      const existingProject = existing?.config?.project?.project
      const firstMonitor = monitors[0]
      const orgId = context?.organization?.id
        ?? firstMonitor?.organizationId
        ?? getStoredOrganization()
        ?? (existingOrg && !existingOrg.startsWith('unknown') ? existingOrg : null)
        ?? 'unknown-org'
      const projectId = context?.project?.id
        ?? firstMonitor?.projectId
        ?? getStoredProject()
        ?? (existingProject && !existingProject.startsWith('unknown') ? existingProject : null)
        ?? 'unknown-project'
      const baseUrl = existing?.config?.api?.baseUrl
        ?? getStoredBaseUrl()
        ?? 'https://app.supercheck.io'

      const configContent = generateConfigContent({
        orgId,
        projectId,
        baseUrl,
        monitors: monitorDefs,
        jobs: jobDefs,
        variables: variableDefs,
        tags: tagDefs,
        notificationProviders: notificationProviderDefs,
        statusPages: statusPageDefs,
        requirements: requirementDefs,
        tests: existing?.config.tests,
      })

      const configPath = existing?.configPath ?? resolve(cwd, options.config ?? 'supercheck.config.ts')
      const configChanged = writeIfChanged(configPath, configContent, summary)

      if (configChanged) {
        logger.header('Config:')
        if (monitorDefs.length > 0) logger.info(pc.green(`  + ${monitorDefs.length} monitor(s)`))
        if (jobDefs.length > 0) logger.info(pc.green(`  + ${jobDefs.length} job(s)`))
        if (variableDefs.length > 0) logger.info(pc.green(`  + ${variableDefs.length} variable(s)`))
        if (tagDefs.length > 0) logger.info(pc.green(`  + ${tagDefs.length} tag(s)`))
        if (notificationProviderDefs.length > 0) logger.info(pc.green(`  + ${notificationProviderDefs.length} notification provider(s)`))
        if (statusPageDefs.length > 0) logger.info(pc.green(`  + ${statusPageDefs.length} status page(s)`))
        if (requirementDefs.length > 0) logger.info(pc.green(`  + ${requirementDefs.length} requirement(s)`))
        logger.success('Updated supercheck.config.ts')
      } else {
        logger.info('supercheck.config.ts is already up to date')
      }
    }

    // ── Summary ──
    logger.newline()

    const totalWritten = summary.tests + summary.monitors + summary.jobs + summary.variables + summary.tags + summary.notificationProviders + summary.statusPages + summary.requirements
    const totalErrors = summary.errors.length

    if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: totalErrors ? 'partial' : 'success', ...summary, configPath: options.testsOnly ? null : existing?.configPath ?? resolve(cwd, options.config ?? 'supercheck.config.ts') }))
    if (totalErrors > 0) {
      for (const error of summary.errors) logger.error(error)
      throw new CLIError(`Pull incomplete: ${totalErrors} error(s). Files already written are preserved.`, ExitCode.GeneralError)
    }

    if (totalWritten === 0 && summary.skipped === 0 && totalErrors === 0) {
      logger.success('Selected remote resources are already up to date locally.')
    } else {
      const resultParts: string[] = []
      if (summary.tests > 0) resultParts.push(`${summary.tests} test(s)`)
      if (summary.monitors > 0) resultParts.push(`${summary.monitors} monitor(s)`)
      if (summary.jobs > 0) resultParts.push(`${summary.jobs} job(s)`)
      if (summary.variables > 0) resultParts.push(`${summary.variables} variable(s)`)
      if (summary.tags > 0) resultParts.push(`${summary.tags} tag(s)`)
      if (summary.notificationProviders > 0) resultParts.push(`${summary.notificationProviders} notification provider(s)`)
      if (summary.statusPages > 0) resultParts.push(`${summary.statusPages} status page(s)`)
      if (summary.requirements > 0) resultParts.push(`${summary.requirements} requirement(s)`)
      if (summary.skipped > 0) resultParts.push(`${summary.skipped} skipped`)

      if (resultParts.length > 0) {
        logger.success(`Pull complete: ${resultParts.join(', ')}`)
      }
    }

    logger.newline()
    logger.info('Next steps:')
    logger.info('  1. Preview changes:       npx supercheck diff')
    logger.info('  2. Deploy changes:        npx supercheck deploy')
    logger.newline()
    logger.info('Tip: Review the changes, then commit to version control.')
    logger.newline()
  })
