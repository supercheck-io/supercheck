import { Command } from 'commander'
import { renameSync } from 'node:fs'
import { resolve } from 'node:path'
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
import { discoverFiles } from '../utils/discovery.js'
import { confirmPrompt } from '../utils/prompt.js'
import { withSpinner } from '../utils/spinner.js'
import { testRelativePath } from '../utils/paths.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { encodeStoredTestScript } from '../utils/script.js'
import pc from 'picocolors'


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

    if (typeof payload.name === 'string' && config.name === undefined) {
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
    testFilesByName: Map<string, string>
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const endpoint = getApiEndpoint(change.type)

    switch (change.action) {
      case 'create': {
        const rawBody = { ...change.local!.definition }
        delete (rawBody as { id?: string }).id
        const body = prepareBodyForApi(change.type, rawBody)

        const response = await client.post(endpoint, body)

        if (change.type === 'test') {
          const responseBody = response.data as { test?: { id?: string; title?: string; type?: string } }
          const createdId = responseBody?.test?.id
          const createdTitle = responseBody?.test?.title ?? change.local?.definition?.title

          const testType = change.local?.definition?.testType === 'k6' ? 'k6' : 'playwright'

          if (createdId && typeof createdTitle === 'string') {
            const existingPath = opts.testFilesByName.get(change.name)
            if (existingPath) {
              const newRelPath = testRelativePath(createdId, createdTitle, testType)
              const newPath = resolve(process.cwd(), newRelPath)

              if (newPath !== existingPath) {
                renameSync(existingPath, newPath)
              }
            }
          }
        }
        return { success: true }
      }
      case 'update': {
        const id = change.id ?? change.remote!.id
        const rawBody = { ...change.local!.definition }
        delete (rawBody as { id?: string }).id
        const body = prepareBodyForApi(change.type, rawBody)
        await client.put(`${endpoint}/${id}`, body)
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
    return { success: false, error: message }
  }
}

export const deployCommand = new Command('deploy')
  .description('Push local config resources to the Supercheck project')
  .option('--config <path>', 'Path to config file')
  .option('--dry-run', 'Show what would change without applying')
  .option('--force', 'Skip confirmation prompt')
  .option('--no-delete', 'Do not delete remote resources missing from config')
  .action(async (options: { config?: string; dryRun?: boolean; force?: boolean; delete?: boolean }) => {
    const cwd = process.cwd()
    const { config } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient(config.api?.baseUrl)

    logger.newline()
    logger.header('Deploying from config...')
    logger.newline()

    const { localResources, remoteResources } = await withSpinner(
      'Comparing local and remote resources...',
      async () => {
        const local = buildLocalResources(config, cwd)
        const remote = await fetchRemoteResources(client)
        return { localResources: local, remoteResources: remote }
      },
      { successText: 'Resources compared' },
    )

    let changes = reconcile(localResources, remoteResources)

    // Filter out deletes if --no-delete
    if (options.delete === false) {
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
      logger.success('No changes to deploy. Everything is in sync.')
      return
    }

    formatChangePlan(changes)

    if (options.dryRun) {
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
      const confirmed = await confirmPrompt('Apply these changes?', { default: false })
      if (!confirmed) {
        logger.info('Deploy aborted.')
        return
      }
    }

    // Apply changes
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

    const testFilesByName = new Map<string, string>()
    const patterns = {
      playwright: config.tests?.playwright?.testMatch,
      k6: config.tests?.k6?.testMatch,
    }
    for (const file of discoverFiles(cwd, patterns)) {
      const key = file.relativePath.replace(/^_supercheck_\//, '')
      testFilesByName.set(key, file.absolutePath)
    }

    for (const change of ordered) {
      const actionLabel = change.action === 'create' ? '+' : change.action === 'update' ? '~' : '-'
      const color = change.action === 'create' ? pc.green : change.action === 'update' ? pc.yellow : pc.red

      const result = await applyChange(client, change, { testFilesByName })

      if (result.success) {
        logger.info(color(`  ${actionLabel} ${change.type}/${change.name} ✓`))
        succeeded++
      } else {
        logger.error(`  ${actionLabel} ${change.type}/${change.name} ✗ ${result.error}`)
        failed++
      }
    }

    logger.newline()

    if (failed > 0) {
      throw new CLIError(
        `Deploy completed with errors: ${succeeded} succeeded, ${failed} failed`,
        ExitCode.GeneralError,
      )
    } else {
      logger.success(`Deploy complete: ${succeeded} change(s) applied successfully`)
    }
  })
