import { verifyContext, managedState } from '../utils/managed.js'
import { buildLocalResources } from '../utils/resources.js'
import { getOutputFormat } from '../output/formatter.js'
import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import { discoverFiles } from '../utils/discovery.js'
import { CLIError, ExitCode, ApiRequestError } from '../utils/errors.js'
import { getApiEndpoint, fetchAllPages } from '../utils/resources.js'
import { withSpinner } from '../utils/spinner.js'
import { extractUuidFromFilename } from '../utils/slug.js'
import type { SupercheckConfig } from '../config/schema.js'
import pc from '../utils/colors.js'


interface ManagedResource {
  id: string
  type: string
  name: string
}

/**
 * Fetch all managed resources (those whose id appears in the local config) from the API.
 * Resources without an `id` in the config are considered new (not yet deployed) and are skipped.
 */
async function fetchManagedResources(
  client: import('../api/client.js').ApiClient,
  config: SupercheckConfig,
  managed: Array<{ type: string; id?: string }> = [],
): Promise<ManagedResource[]> {
  const resources: ManagedResource[] = []

  // Collect ids from config to know what's managed
  const managedIds = new Set<string>(managed.filter((r) => r.id).map((r) => `${r.type}:${r.id}`))

  if (config.jobs) {
    for (const j of config.jobs) {
      if (j.id) managedIds.add(`job:${j.id}`)
    }
  }
  if (config.variables) {
    for (const v of config.variables) {
      if (v.id) managedIds.add(`variable:${v.id}`)
    }
  }
  if (config.tags) {
    for (const t of config.tags) {
      if (t.id) managedIds.add(`tag:${t.id}`)
    }
  }
  if (config.notificationProviders) {
    for (const provider of config.notificationProviders) {
      if (provider.id) managedIds.add(`notificationProvider:${provider.id}`)
    }
  }
  if (Array.isArray(config.monitors)) {
    for (const m of config.monitors) {
      if (m.id) managedIds.add(`monitor:${m.id}`)
    }
  }
  if (Array.isArray(config.statusPages)) {
    for (const sp of config.statusPages) {
      if (sp.id) managedIds.add(`statusPage:${sp.id}`)
    }
  }

  // Discover test files — extract UUIDs from filenames to match remote tests by id.
  // Files are named `{slug}.{uuid}.pw.ts` / `{slug}.{uuid}.k6.ts` after `supercheck pull`.
  // Also supports legacy `{uuid}.pw.ts` format.
  const patterns = {
    playwright: config.tests?.playwright?.testMatch,
    k6: config.tests?.k6?.testMatch,
  }
  const cwd = process.cwd()
  const files = discoverFiles(cwd, patterns)
  const testIds = new Set<string>(managed.filter((r) => r.type === 'test' && r.id).map((r) => r.id!))
  for (const f of files) {
    const uuid = extractUuidFromFilename(f.filename)
    if (uuid) {
      testIds.add(uuid)
    }
  }

  // Fetch remote resources and filter to managed ones
  try {
    const jobs = await fetchAllPages<Record<string, unknown>>(client, '/api/jobs', 'jobs')
    for (const job of jobs) {
      if (job.id && managedIds.has(`job:${String(job.id)}`)) {
        resources.push({ id: String(job.id), type: 'job', name: String(job.name ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('jobs', err) }

  try {
    const tests = await fetchAllPages<Record<string, unknown>>(client, '/api/tests', 'tests')
    for (const test of tests) {
      // Match by database id — local test files are named `{uuid}.pw.ts`
      if (test.id && testIds.has(String(test.id))) {
        resources.push({ id: String(test.id), type: 'test', name: String(test.title ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('tests', err) }

  try {
    const monitors = await fetchAllPages<Record<string, unknown>>(client, '/api/monitors', 'monitors')
    for (const monitor of monitors) {
      if (monitor.id && managedIds.has(`monitor:${String(monitor.id)}`)) {
        resources.push({ id: String(monitor.id), type: 'monitor', name: String(monitor.name ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('monitors', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/variables')
    for (const v of data) {
      if (v.id && managedIds.has(`variable:${String(v.id)}`)) {
        resources.push({ id: String(v.id), type: 'variable', name: String(v.key ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('variables', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/tags')
    for (const t of data) {
      if (t.id && managedIds.has(`tag:${String(t.id)}`)) {
        resources.push({ id: String(t.id), type: 'tag', name: String(t.name ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('tags', err) }

  try {
    const { data } = await client.get<Array<Record<string, unknown>>>('/api/notification-providers')
    for (const provider of data) {
      if (provider.id && managedIds.has(`notificationProvider:${String(provider.id)}`)) {
        resources.push({ id: String(provider.id), type: 'notificationProvider', name: String(provider.name ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('notification providers', err) }

  try {
    const statusPages = await fetchAllPages<Record<string, unknown>>(client, '/api/status-pages', 'status-pages')
    for (const sp of statusPages) {
      if (sp.id && managedIds.has(`statusPage:${String(sp.id)}`)) {
        resources.push({ id: String(sp.id), type: 'statusPage', name: String(sp.name ?? '') })
      }
    }
  } catch (err) { logDestroyFetchError('status-pages', err) }

  return resources
}

/**
 * Log fetch errors with appropriate severity for the destroy command.
 */
function logDestroyFetchError(resourceType: string, err: unknown): void {
  if (err instanceof ApiRequestError && err.statusCode === 404) {
    logger.debug(`Could not fetch ${resourceType} (not found)`)
  } else {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CLIError(`Incomplete inventory: could not fetch ${resourceType}: ${msg}`, ExitCode.ApiError)
  }
}

export const destroyCommand = new Command('destroy')
  .description('Tear down managed resources from the Supercheck project')
  .option('--config <path>', 'Path to config file')
  .option('--dry-run', 'Show what would be destroyed without applying')
  .option('--force', 'Skip confirmation prompt')
  .action(async (options: { config?: string; dryRun?: boolean; force?: boolean }) => {
    const cwd = process.cwd()
    const { config, configPath } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient(config.api?.baseUrl)
    const context = await verifyContext(client, config)
    const state = managedState(client, context, configPath)

    logger.newline()

    const managed = await withSpinner(
      'Scanning for managed resources...',
      () => fetchManagedResources(client, config, state.apply(buildLocalResources(config, cwd))),
      { successText: 'Scan complete' },
    )

    if (managed.length === 0) {
      if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: 'no_change', context, results: [] }))
      logger.success('No managed resources found on the remote project.')
      return
    }

    logger.header('Resources to destroy:')
    logger.newline()
    for (const r of managed) {
      logger.info(pc.red(`  - ${r.type}/${r.name} [${r.id}]`))
    }
    logger.newline()
    logger.warn(`This will permanently delete ${pc.bold(String(managed.length))} resource(s).`)
    logger.newline()

    if (options.dryRun) {
      if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: 'preview', context, resources: managed }))
      logger.info(pc.yellow('Dry run — no resources destroyed.'))
      return
    }

    if (!options.force) {
      throw new CLIError(
        'CONFIRMATION_REQUIRED: Use --force to confirm destruction, or --dry-run to preview.',
        ExitCode.ConfigError,
        { status: 'confirmation_required', context, changes: managed, confirmArgs: [...process.argv.slice(2), '--force'] },
      )
    }

    logger.info('Destroying resources...')
    logger.newline()

    const results: Record<string, unknown>[] = []
    let succeeded = 0
    let failed = 0

    // Delete in reverse dependency order:
    // Jobs reference tests, so jobs must be deleted first to unblock test deletion.
    // Monitors and status pages are independent, then vars/tags last.
    const deleteOrder = ['statusPage', 'job', 'monitor', 'notificationProvider', 'variable', 'tag', 'test']
    const sorted = [...managed].sort((a, b) => deleteOrder.indexOf(a.type) - deleteOrder.indexOf(b.type))

    for (const resource of sorted) {
      try {
        const endpoint = getApiEndpoint(resource.type)
        await client.delete(`${endpoint}/${resource.id}`)
        logger.info(pc.red(`  - ${resource.type}/${resource.name} ✓`))
        results.push({ ...resource, deleted: true })
        succeeded++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.error(`  - ${resource.type}/${resource.name} ✗ ${msg}`)
        results.push({ ...resource, deleted: false, error: msg })
        failed++
      }
    }

    logger.newline()

    if (getOutputFormat() === 'json') logger.output(JSON.stringify({ status: failed ? 'partial' : 'success', context, results, succeeded, failed }))
    if (failed > 0) {
      throw new CLIError(
        `Destroy completed with errors: ${succeeded} destroyed, ${failed} failed`,
        ExitCode.GeneralError,
      )
    } else {
      logger.success(`Destroy complete: ${succeeded} resource(s) removed`)
    }
  })
