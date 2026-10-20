import { managedState, verifyContext, describeTarget, deploymentLock, rejectAmbiguousCreates } from '../utils/managed.js'
import { getOutputFormat } from '../output/formatter.js'
import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import {
  reconcile,
  formatChangePlan,
  type ResourceChange,
} from '../utils/reconcile.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { buildLocalResources, fetchRemoteResources, getApiEndpoint } from '../utils/resources.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { encodeStoredTestScript } from '../utils/script.js'
import pc from '../utils/colors.js'
import { waitForRun } from '../utils/wait.js'
import { parseIntStrict } from '../utils/number.js'

/**
 * Prepare the body for API request by transforming local config shape
 * back to the raw API shape (reversing pull/normalization logic).
 */
function prepareBodyForApi(type: string, body: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...body }

  if (type === 'test') {
    // Map local testType to API "type"
    const normalizedType = normalizeTestTypeForApi(payload.testType)
    if (normalizedType) payload.type = normalizedType
    delete payload.testType
    if (typeof payload.script === 'string') {
      payload.script = encodeStoredTestScript(payload.script)
    }
  }

  if (type === 'job') {
    delete payload.status

    // Resolve test paths back to UUIDs and wrap in {id} objects
    // API expects tests: Array<{ id: string }>, not string[]
    if (Array.isArray(payload.tests)) {
      payload.tests = (payload.tests as string[]).map((t) => {
        // Extract UUID from path: _supercheck_/homepage.019a1234-....pw.ts
        const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(t)
        const id = match ? match[1] : t
        return { id }
      })
    }
  }

  if (type === 'statusPage') {
    // Map description back to pageDescription
    if (payload.description) {
      payload.pageDescription = payload.description
      delete payload.description
    }
  }

  if (type === 'notificationProvider') {
    const config =
      payload.config && typeof payload.config === 'object'
        ? { ...(payload.config as Record<string, unknown>) }
        : {}

    if (typeof payload.name === 'string') {
      config.name = payload.name
    }

    payload.config = config
  }

  return payload
}

/**
 * Apply a single resource change via the API.
 */
async function applyChange(
  client: import('../api/client.js').ApiClient,
  change: ResourceChange,
  opts: {
    state: ReturnType<typeof managedState>
  },
): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const endpoint = getApiEndpoint(change.type)

    let body: Record<string, unknown> = {}
    if (change.action === 'create' || change.action === 'update') {
      const rawBody = { ...change.local!.definition }
      delete rawBody.id
      if (rawBody.alertConfig && typeof rawBody.alertConfig === 'object' && 'notificationProviders' in rawBody.alertConfig && Array.isArray(rawBody.alertConfig.notificationProviders)) {
        rawBody.alertConfig = { ...rawBody.alertConfig, notificationProviders: rawBody.alertConfig.notificationProviders.map((ref) => opts.state.resolve('notificationProvider', String(ref))) }
      }
      if (change.type === 'job' && Array.isArray(rawBody.tests)) {
        rawBody.tests = rawBody.tests.map((ref) => opts.state.resolve('test', String(ref)))
      }
      if (change.type === 'monitor' && rawBody.type === 'synthetic_test' && rawBody.config && typeof rawBody.config === 'object') {
        const config = { ...rawBody.config as Record<string, unknown> }
        if (typeof config.testId === 'string') config.testId = opts.state.resolve('test', config.testId)
        rawBody.config = config
      }
      // An unset environment variable evaluates to '' in a pulled config. Never send that as a secret's value: on update
      // it would overwrite the stored secret with an empty one, and on create it would store nothing useful.
      if (change.type === 'variable' && rawBody.isSecret === true && (rawBody.value === undefined || rawBody.value === '')) {
        if (change.action === 'create') throw new CLIError(`Secret variable "${change.name}" has no value. Set its environment variable before deploying.`, ExitCode.ConfigError)
        delete rawBody.value
      }
      body = prepareBodyForApi(change.type, rawBody)
    }
    switch (change.action) {
      case 'create': {
        const response = await client.post(endpoint, body)

        const data = response.data as Record<string, unknown>
        const entity = (data[change.type] ?? data.provider ?? data.variable ?? data.job ?? data.test ?? data) as Record<string, unknown>
        const id = entity.id
        if (typeof id !== 'string') throw new CLIError('Create succeeded but returned no ID. Inspect remote state before retrying.', ExitCode.ApiError)
        try { opts.state.record(change.type, change.name, id, change.id ?? change.local?.id) } catch {
        throw new CLIError('Remote create succeeded but identity could not be saved. Inspect the returned ID and state file before retrying.', ExitCode.ConfigError, { id })
        }
        return { success: true, id }
      }
      case 'update': {
        const id = change.id ?? change.remote!.id
        await client.put(`${endpoint}/${id}`, body)
        opts.state.record(change.type, change.name, id)
        return { success: true }
      }
      case 'delete': {
        const id = change.id ?? change.remote!.id
        await client.delete(`${endpoint}/${id}`)
        return { success: true }
      }
      default:
        return { success: true }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const id = err instanceof CLIError && err.details && typeof err.details === 'object' && 'id' in err.details ? String(err.details.id) : undefined
    return { success: false, id, error: message }
  }
}

const VERIFY_LIMIT = 5
/** Skipped tests (k6, over the cap) were deliberately not run, so they never fail a deploy; errors and failed runs do. */
export function failedVerifications(verification: Record<string, unknown>[] | undefined): Record<string, unknown>[] {
  return (verification ?? []).filter((v) => v.status !== 'passed' && v.status !== 'skipped')
}
export async function verifyDeployedTests(
  client: ReturnType<typeof createAuthenticatedClient>,
  changes: { action: string; type: string; name: string; id?: string; local?: { definition: Record<string, unknown> } }[],
  results: Record<string, unknown>[],
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  const targets = changes.flatMap((change, index) => {
    if (change.type !== 'test' || !['create', 'update'].includes(change.action)) return []
    const id = typeof results[index]?.id === 'string' ? String(results[index].id) : change.id
    return id ? [{ id, name: change.name, testType: normalizeTestTypeForApi(change.local?.definition?.testType) }] : []
  })
  for (const target of targets) {
    // Only a positively identified browser test is ever run. Performance (any spelling) and unknown types are skipped.
    if (target.testType !== 'browser') { out.push({ id: target.id, name: target.name, status: 'skipped', reason: target.testType === 'performance' ? 'Performance tests are not run implicitly; use `supercheck test execute` with explicit authorization.' : target.testType ? `Only browser tests are verified automatically; ${target.testType} tests are not run implicitly.` : 'Test type could not be determined; not run implicitly.' }); continue }
    if (out.filter((o) => o.status !== 'skipped').length >= VERIFY_LIMIT) { out.push({ id: target.id, name: target.name, status: 'skipped', reason: `Verification is limited to ${VERIFY_LIMIT} tests per deploy.` }); continue }
    let runId: string | undefined
    try {
      const { data } = await client.post<Record<string, unknown>>(`/api/tests/${target.id}/execute`, {}, { retries: 0 })
      runId = typeof data.runId === 'string' ? data.runId : undefined
      if (!runId) { out.push({ id: target.id, name: target.name, status: 'error', reason: 'Execution returned no run ID.' }); continue }
      const run = await waitForRun(client, runId, timeoutMs)
      out.push({ id: target.id, name: target.name, runId, status: String((run as Record<string, unknown>).derivedStatus ?? (run as Record<string, unknown>).status ?? 'unknown') })
    } catch (error) {
      // Keep the accepted run ID so the caller can resume observation instead of triggering again.
      out.push({ id: target.id, name: target.name, ...(runId ? { runId } : {}), status: 'error', reason: error instanceof Error ? error.message : 'Verification failed' })
    }
  }
  return out
}

export const deployCommand = new Command('deploy')
  .description('Push local config resources to the Supercheck project')
  .option('--config <path>', 'Path to config file')
  .option('--delete', 'Delete ALL remote resources absent from config (including resources created elsewhere)', false)
  .option('--dry-run', 'Show what would change without applying')
  .option('--force', 'Skip confirmation prompt')
  .option('--no-delete', 'Do not delete remote resources missing from config')
  .option('--verify', 'After a successful deploy, execute the created or updated browser tests once in the cloud and wait for the result')
  .option('--verify-timeout <seconds>', 'With --verify: maximum wait per test', '300')
  .action(async (options: { config?: string; dryRun?: boolean; force?: boolean; delete?: boolean; verify?: boolean; verifyTimeout?: string }) => {
    // Validate before any write so a typo cannot leave a half-reported deploy.
    const verifyTimeoutMs = options.verify ? parseIntStrict(options.verifyTimeout ?? '300', '--verify-timeout', { min: 1 }) * 1000 : 0
    const cwd = process.cwd()
    const { config, configPath, declaredBaseUrl } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient(config.api?.baseUrl)
    const context = await verifyContext(client, config, false, declaredBaseUrl)
    logger.info(`Target: ${describeTarget(context)}`)
    const release = options.dryRun ? () => undefined : deploymentLock(configPath)
    try {
      const state = managedState(client, context, configPath)
      const emit = (data: Record<string, unknown>) => { if (getOutputFormat() === 'json') logger.output(JSON.stringify({ context, ...data })) }

      logger.newline()
      logger.header('Deploying from config...')
      logger.newline()

      const { localResources, remoteResources } = await withSpinner(
        'Comparing local and remote resources...',
        async () => {
          const local = state.resolveTests(state.apply(buildLocalResources(config, cwd)))
          const remote = await fetchRemoteResources(client)
          return { localResources: local, remoteResources: remote }
        },
        { successText: 'Resources compared' },
      )

      rejectAmbiguousCreates(localResources, remoteResources)
      let changes = reconcile(localResources, remoteResources)

      // Filter out deletes if --no-delete
      if (options.delete !== true) {
        changes = changes.filter((c) => c.action !== 'delete')
      }

      const actionable = changes.filter((c) => c.action !== 'no-change')

      const unsupportedStatusPageMutations = actionable.filter(
        (c) => c.type === 'statusPage' && (c.action === 'create' || c.action === 'update'),
      )

      if (unsupportedStatusPageMutations.length > 0) {
        throw new CLIError(
          'Status page create/update is not supported by the current API. Remove statusPages create/update changes from config (or apply them in the dashboard) and run deploy again.',
          ExitCode.ConfigError,
        )
      }

      if (actionable.length === 0) {
        if (!options.dryRun) for (const change of changes) if (change.id) state.record(change.type, change.name, change.id)
        emit({ status: 'no_change', changes: [] })
        logger.success('No config changes to deploy. Remote resources absent from config are preserved.')
        return
      }

      if (getOutputFormat() !== 'json') formatChangePlan(changes)
      const deletions = actionable.filter((change) => change.action === 'delete')
      if (deletions.length > 0) logger.warn(`${deletions.length} remote resource(s) will be deleted, including any created outside this config.`)

      if (options.dryRun) {
        emit({ status: 'preview', changes: changes.map(({ action, type, id, name, details }) => ({ action, type, id, name, details })) })
        logger.info(pc.yellow('Dry run — no changes applied.'))
        return
      }

      // Validate test scripts before applying changes
      const testsToValidate = actionable.filter((c) => c.type === 'test' && (c.action === 'create' || c.action === 'update'))
      if (testsToValidate.length > 0) {
        await withSpinner('Validating test scripts...', async () => {
          // Fast client-side script-type mismatch detection
          for (const change of testsToValidate) {
            const script = String(change.local?.definition?.script ?? '')
            const declaredType = normalizeTestTypeForApi(change.local?.definition?.testType)
            const mismatch = validateScriptTypeMatch(script, declaredType)
            if (mismatch) {
              throw new CLIError(`${change.name}: ${mismatch}`, ExitCode.ConfigError)
            }
          }

          const inputs = testsToValidate.map((change) => ({
            name: change.name,
            script: String(change.local?.definition?.script ?? ''),
            testType: normalizeTestTypeForApi(change.local?.definition?.testType),
          }))

          const results = await validateScripts(client, inputs)
          const failures = results.filter((r) => !r.valid)
          if (failures.length > 0) {
            const details = failures.map((f) => `  - ${f.name}: ${f.error ?? 'Validation failed'}`).join('\n')
            throw new CLIError(`Validation failed:\n${details}`, ExitCode.ConfigError)
          }

          const warnings = results.filter((r) => r.warnings && r.warnings.length > 0)
          for (const warn of warnings) {
            logger.warn(`Validation warnings for ${warn.name}: ${(warn.warnings ?? []).join(', ')}`)
          }
        }, { successText: 'Test scripts validated' })
      }

      if (!options.force) {
        await confirmPrompt('Apply these changes?', { default: false, context, changes: actionable.map(({ action, type, id, name, details }) => ({ action, type, id, name, details })) })
      }

      // Apply changes
      for (const change of changes) if (change.action === 'no-change' && change.id) state.record(change.type, change.name, change.id)
      logger.info('Applying changes...')
      logger.newline()

      let succeeded = 0
      let failed = 0

      // Apply creates first, then updates, then deletes
      const ordered = [
        ...actionable.filter((c) => c.action === 'create'),
        ...actionable.filter((c) => c.action === 'update'),
        ...actionable.filter((c) => c.action === 'delete'),
      ]

      const rank = ['notificationProvider', 'tag', 'variable', 'test', 'monitor', 'job', 'statusPage']
      ordered.sort((a, b) => {
        if (a.action === 'delete' || b.action === 'delete') {
          return a.action === b.action ? rank.indexOf(b.type) - rank.indexOf(a.type) : a.action === 'delete' ? 1 : -1
        }
        return rank.indexOf(a.type) - rank.indexOf(b.type)
      })
      const results: Record<string, unknown>[] = []
      for (const change of ordered) {
        const actionLabel = change.action === 'create' ? '+' : change.action === 'update' ? '~' : '-'
        const color = change.action === 'create' ? pc.green : change.action === 'update' ? pc.yellow : pc.red

        const result = await applyChange(client, change, { state })
        results.push({ action: change.action, type: change.type, name: change.name, id: result.id ?? change.id, ...result })

        if (result.success) {
          logger.info(color(`  ${actionLabel} ${change.type}/${change.name} ✓`))
          succeeded++
        } else {
          logger.error(`  ${actionLabel} ${change.type}/${change.name} ✗ ${result.error}`)
          failed++
          break
        }
      }

      logger.newline()

      // Optional cloud proof: run each created/updated browser or API test once. Performance (k6) tests are never
      // run implicitly because they consume load budget and need explicit authorization of target, load and spend.
      let verification: Record<string, unknown>[] | undefined
      if (options.verify && !options.dryRun && failed === 0) {
        verification = await verifyDeployedTests(client, ordered, results, verifyTimeoutMs)
      }
      emit({ status: failed ? 'partial' : 'success', results, succeeded, failed, skipped: ordered.length - results.length, statePath: state.path, ...(verification ? { verification } : {}) })
      const unverified = failedVerifications(verification)
      if (unverified.length > 0 && failed === 0) {
        throw new CLIError(`Deploy succeeded but ${unverified.length} cloud verification run(s) did not pass. Inspect the run IDs in the output; do not re-trigger blindly.`, ExitCode.GeneralError, { verification })
      }
      if (failed > 0) {
        throw new CLIError(
          `Deploy completed with errors: ${succeeded} succeeded, ${failed} failed`,
          ExitCode.GeneralError,
        )
      } else {
        logger.success(`Deploy complete: ${succeeded} change(s) applied successfully`)
      }
    } finally { release() }
  })
