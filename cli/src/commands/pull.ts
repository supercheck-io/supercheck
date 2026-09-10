import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { tryLoadConfig } from '../config/loader.js'
import { getStoredBaseUrl, getStoredOrganization, getStoredProject } from '../auth/store.js'
import { logger } from '../utils/logger.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode, ApiRequestError } from '../utils/errors.js'
import { fetchAllPages } from '../utils/resources.js'
import { detectPackageManager, ensurePackageJson, installDependencies } from '../utils/package-manager.js'
import { extractUuidFromFilename } from '../utils/slug.js'
import { testRelativePath, testTypeToFolder } from '../utils/paths.js'
import { decodeStoredTestScript } from '../utils/script.js'

import pc from 'picocolors'
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

interface RemoteStatusPage {
  id: string
  name: string
  subdomain?: string
  status?: string
  pageDescription?: string
  headline?: string
  supportUrl?: string
  language?: string
  allowEmailSubscribers?: boolean
  allowWebhookSubscribers?: boolean
  allowRssFeed?: boolean
  cssBodyBackgroundColor?: string
  cssFontColor?: string
  cssGreens?: string
  cssReds?: string
  createdAt?: string
  updatedAt?: string
}

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
  skipped: number
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
function writeIfChanged(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8')
    if (existing === content) return false
  }

  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, content, 'utf-8')
  return true
}

function decodeScript(script: string | undefined): string | null {
  return decodeStoredTestScript(script)
}

// ────────────────────────────────────────────────────────────────
// Fetch functions
// ────────────────────────────────────────────────────────────────

async function fetchContext(client: ApiClient): Promise<RemoteContext | null> {
  try {
    const { data } = await client.get<{ success: boolean } & RemoteContext>('/api/context')
    // Validate that we got meaningful data
    if (data?.organization?.id && data?.project?.id) {
      return data
    }
    logger.debug('Context response missing organization or project ID')
    return null
  } catch (err) {
    logger.warn(`Could not fetch project context: ${err instanceof Error ? err.message : String(err)}`)
    logger.debug('Organization and project will be set to placeholder values. Re-run after fixing connectivity.')
    return null
  }
}

async function fetchTests(client: ApiClient): Promise<RemoteTest[]> {
  try {
    return await fetchAllPages<RemoteTest>(client, '/api/tests', 'tests')
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
  try {
    return await fetchAllPages<RemoteStatusPage>(client, '/api/status-pages', 'status-pages')
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
function pullTests(tests: RemoteTest[], cwd: string, summary: PullSummary): void {
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
        if (uuid) existingByUuid.set(uuid, `${folder}/${file}`)
      }
    }
  } catch {
    // Directory may not exist yet — that's fine
  }

  for (const test of tests) {
    try {
      const testType = mapTestType(test.type)
      const relPath = testRelativePath(test.id, test.title, testType)
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

      // Inject/Update @title metadata to preserve human-readable name in local file
      // Prefer JSDoc injection if a block exists, otherwise use single-line comment
      if (/@title\s+/.test(script)) {
        // Update existing @title (works for both // @title and * @title)
        script = script.replace(/(@title\s+)(.+?)(\r?\n|\*\/|$)/, `$1${test.title}$3`)
      } else if (/\/\*\*([\s\S]*?)\*\//.test(script)) {
        // Inject into existing JSDoc
        script = script.replace(/(\/\*\*)/, `$1\n * @title ${test.title}`)
      } else {
        // No JSDoc or existing title, prepend // @title
        script = `// @title ${test.title}\n\n${script}`
      }

      // Clean up old file if UUID exists but filename changed (e.g., test renamed)
      const existingFilename = existingByUuid.get(test.id)
      const currentFile = relPath.replace(/^_supercheck_\//, '')
      if (existingFilename && existingFilename !== currentFile) {
        const oldPath = resolve(baseDir, existingFilename)
        try {
          unlinkSync(oldPath)
          logger.debug(`  Renamed: ${existingFilename} → ${currentFile}`)
        } catch {
          // Old file may have been manually deleted — ignore
        }
      }

      const filePath = resolve(cwd, relPath)
      const written = writeIfChanged(filePath, script)

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
function buildMonitorDefinitions(
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
    if (m.frequencyMinutes !== undefined) def.frequencyMinutes = m.frequencyMinutes
    if (m.enabled !== undefined) def.enabled = m.enabled

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

    return def
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
 * Build variable definitions from remote data.
 * Secret values are never written to config.
 */
function buildVariableDefinitions(variables: RemoteVariable[]): Record<string, unknown>[] {
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
      // Use bracket notation for names that aren't valid JS identifiers
      // (e.g. keys containing dashes, dots, spaces, or starting with digits)
      const isValidIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(envVarName)
      def.value = isValidIdentifier
        ? `\${${envVarName}}`
        : `\${[${envVarName}]}`
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
 * Build status page definitions from remote data.
 * Keeps essential config only — branding and styling are managed via the dashboard.
 */
function buildStatusPageDefinitions(pages: RemoteStatusPage[]): Record<string, unknown>[] {
  return pages.map((p) => {
    const def: Record<string, unknown> = {
      id: p.id,
      name: p.name,
    }

    if (p.subdomain) def.subdomain = p.subdomain
    if (p.status) def.status = p.status
    if (p.pageDescription) def.description = p.pageDescription
    if (p.headline) def.headline = p.headline
    if (p.supportUrl) def.supportUrl = p.supportUrl
    if (p.language && p.language !== 'en') def.language = p.language

    // Note: branding (colors, fonts) is intentionally omitted —
    // visual customization is better managed via the dashboard.

    return def
  })
}

// ────────────────────────────────────────────────────────────────
// Config generator
// ────────────────────────────────────────────────────────────────

/**
 * Generate a supercheck.config.ts file from pulled remote resources.
 */
function generateConfigContent(opts: {
  orgId: string
  projectId: string
  baseUrl: string
  monitors: Record<string, unknown>[]
  jobs: Record<string, unknown>[]
  variables: Record<string, unknown>[]
  tags: Record<string, unknown>[]
  notificationProviders: Record<string, unknown>[]
  statusPages: Record<string, unknown>[]
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
  parts.push(`    organization: '${opts.orgId}',`)
  parts.push(`    project: '${opts.projectId}',`)
  parts.push('  },')
  parts.push('')

  // API
  parts.push('  // API connection — set SUPERCHECK_URL env var for self-hosted or staging')
  parts.push('  api: {')
  parts.push(`    baseUrl: process.env.SUPERCHECK_URL ?? '${opts.baseUrl}',`)
  parts.push('  },')
  parts.push('')

  // Tests
  parts.push('  // Test file patterns — Playwright (.pw.ts) and k6 (.k6.ts) scripts')
  parts.push('  tests: {')
  parts.push('    playwright: {')
  parts.push(`      testMatch: '_supercheck_/playwright/**/*.pw.ts',`)
  parts.push('    },')
  parts.push('    k6: {')
  parts.push(`      testMatch: '_supercheck_/k6/**/*.k6.ts',`)
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
      .map(([key, value]) => `${innerIndent}  ${key}: ${formatValue(value, baseIndent + 2)},`)
      .join('\n')
    return `${innerIndent}{\n${fields}\n${innerIndent}}`
  })

  return `[\n${items.join(',\n')}\n${indent}]`
}

/**
 * Format a value for TypeScript source output.
 * Produces clean, readable TS syntax (not JSON.stringify).
 */
function formatValue(value: unknown, indent = 0): string {
  if (typeof value === 'string') {
    // Check if it's an env var reference like ${VAR_NAME} or ${[VAR-NAME]}
    if (value.startsWith('${') && value.endsWith('}')) {
      const inner = value.slice(2, -1)
      // Bracket-notation reference: ${[VAR-NAME]} → process.env['VAR-NAME']
      if (inner.startsWith('[') && inner.endsWith(']')) {
        const varName = inner.slice(1, -1)
        return `process.env['${varName.replace(/'/g, "\\'")}'] ?? ''`
      }
      return `process.env.${inner} ?? ''`
    }
    return `'${value.replace(/'/g, "\\'")}'`
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return 'undefined'
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((v) => typeof v === 'string')) {
      return `[${value.map((v) => `'${String(v).replace(/'/g, "\\'")}'`).join(', ')}]`
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
      .map(([key, v]) => `${innerIndent}${key}: ${formatValue(v, indent + 1)}`)
      .join(',\n')
    return `{\n${fields},\n${'  '.repeat(indent)}}`
  }
  return String(value)
}

// ────────────────────────────────────────────────────────────────
// Pull Command
// ────────────────────────────────────────────────────────────────

export const pullCommand = new Command('pull')
  .description('Pull tests, monitors, jobs, status pages, and config from the Supercheck cloud into the local project')
  .option('--config <path>', 'Path to config file')
  .option('--force', 'Overwrite existing local files without prompting')
  .option('--tests-only', 'Only pull test scripts')
  .option('--config-only', 'Only pull config (monitors, jobs, notification providers, variables, tags, status pages)')
  .option('--dry-run', 'Show what would be pulled without writing files')
  .action(async (options: {
    config?: string
    force?: boolean
    testsOnly?: boolean
    configOnly?: boolean
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

    const client = createAuthenticatedClient(existing?.config?.api?.baseUrl)

    logger.newline()
    logger.header('Pulling from Supercheck cloud...')
    logger.newline()

    // ── Fetch project/org context and all remote resources in parallel ──
    const [context, tests, monitors, jobs, variables, tags, notificationProviders, statusPages] = await withSpinner(
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
        ])
        return results as [RemoteContext | null, RemoteTest[], RemoteMonitor[], RemoteJob[], RemoteVariable[], RemoteTag[], RemoteNotificationProvider[], RemoteStatusPage[]]
      },
      { successText: 'Fetched remote resources' },
    )

    logger.debug(`Found: ${tests.length} tests, ${monitors.length} monitors, ${jobs.length} jobs, ${variables.length} variables, ${tags.length} tags, ${notificationProviders.length} notification providers, ${statusPages.length} status pages`)

    const totalResources = tests.length + monitors.length + jobs.length + variables.length + tags.length + notificationProviders.length + statusPages.length
    if (totalResources === 0) {
      logger.warn('No resources found on the remote project.')
      logger.info('Hint: Create tests and monitors in the Supercheck dashboard, then run `supercheck pull` again.')
      return
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
          const typeLabel = v.type === 'file' ? ' (file)' : v.type === 'secret' ? ' (secret)' : ''
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

      logger.newline()
      logger.info(pc.yellow('Dry run — no files written.'))
      logger.newline()
      return
    }

    // ── Confirm if not --force ──
    if (!options.force) {
      logger.info(`Found ${pc.bold(String(totalResources))} resources to pull.`)
      logger.info('This will write test scripts and update supercheck.config.ts.')
      logger.newline()

      const { confirmPrompt } = await import('../utils/prompt.js')
      const confirmed = await confirmPrompt('Continue?', { default: true })
      if (!confirmed) {
        logger.info('Pull aborted.')
        return
      }
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
      skipped: 0,
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
            fullTests.push(data)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            logger.warn(`  Could not fetch script for "${t.title}": ${msg}`)
            summary.errors.push(`test "${t.title}": ${msg}`)
          }
        }
      }

      pullTests(fullTests, cwd, summary)
      logger.newline()
    }

    // ── Install dependencies if package.json is missing ──
    const pkgPath = resolve(cwd, 'package.json')
    if (!options.dryRun && !existsSync(pkgPath)) {
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
      const testMap = new Map<string, string>()
      for (const t of tests) {
        const testType = mapTestType(t.type)
        const filePath = testRelativePath(t.id, t.title, testType)
        testMap.set(t.id, filePath)
      }

      const monitorDefs = buildMonitorDefinitions(monitors)
      const jobDefs = buildJobDefinitions(jobs, testMap)
      const variableDefs = buildVariableDefinitions(variables)
      const tagDefs = buildTagDefinitions(tags)
      const notificationProviderDefs = buildNotificationProviderDefinitions(notificationProviders)
      const statusPageDefs = buildStatusPageDefinitions(statusPages)

      summary.monitors = monitors.length
      summary.jobs = jobs.length
      summary.variables = variableDefs.length
      summary.tags = tags.length
      summary.notificationProviders = notificationProviderDefs.length
      summary.statusPages = statusPages.length

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
      })

      const configPath = resolve(cwd, 'supercheck.config.ts')
      const configChanged = writeIfChanged(configPath, configContent)

      if (configChanged) {
        logger.header('Config:')
        if (monitorDefs.length > 0) logger.info(pc.green(`  + ${monitorDefs.length} monitor(s)`))
        if (jobDefs.length > 0) logger.info(pc.green(`  + ${jobDefs.length} job(s)`))
        if (variableDefs.length > 0) logger.info(pc.green(`  + ${variableDefs.length} variable(s)`))
        if (tagDefs.length > 0) logger.info(pc.green(`  + ${tagDefs.length} tag(s)`))
        if (notificationProviderDefs.length > 0) logger.info(pc.green(`  + ${notificationProviderDefs.length} notification provider(s)`))
        if (statusPageDefs.length > 0) logger.info(pc.green(`  + ${statusPageDefs.length} status page(s)`))
        logger.success('Updated supercheck.config.ts')
      } else {
        logger.info('supercheck.config.ts is already up to date')
      }
    }

    // ── Summary ──
    logger.newline()

    const totalWritten = summary.tests + summary.monitors + summary.jobs + summary.variables + summary.tags + summary.notificationProviders + summary.statusPages
    const totalErrors = summary.errors.length

    if (totalErrors > 0) {
      logger.header('Errors:')
      for (const err of summary.errors) {
        logger.error(`  ${err}`)
      }
      logger.newline()
    }

    if (totalWritten === 0 && summary.skipped === 0 && totalErrors === 0) {
      logger.success('Everything is already in sync.')
    } else {
      const resultParts: string[] = []
      if (summary.tests > 0) resultParts.push(`${summary.tests} test(s)`)
      if (summary.monitors > 0) resultParts.push(`${summary.monitors} monitor(s)`)
      if (summary.jobs > 0) resultParts.push(`${summary.jobs} job(s)`)
      if (summary.variables > 0) resultParts.push(`${summary.variables} variable(s)`)
      if (summary.tags > 0) resultParts.push(`${summary.tags} tag(s)`)
      if (summary.notificationProviders > 0) resultParts.push(`${summary.notificationProviders} notification provider(s)`)
      if (summary.statusPages > 0) resultParts.push(`${summary.statusPages} status page(s)`)
      if (summary.skipped > 0) resultParts.push(`${summary.skipped} skipped`)

      if (resultParts.length > 0) {
        logger.success(`Pull complete: ${resultParts.join(', ')}`)
      }
    }

    logger.newline()
    logger.info('Next steps:')
    logger.info('  1. Install dependencies:  npm install -D @supercheck/cli typescript')
    logger.info('  2. Preview changes:       npx supercheck diff')
    logger.info('  3. Deploy changes:        npx supercheck deploy')
    logger.newline()
    logger.info('Tip: Review the changes, then commit to version control.')
    logger.newline()
  })
