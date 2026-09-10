import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { ApiClient } from '../api/client.js'
import { loadConfig } from '../config/loader.js'
import { discoverFiles } from '../utils/discovery.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { parseIntStrict } from '../utils/number.js'
import type { PaginatedResponse } from '../api/client.js'
import { getStoredBaseUrl, requireTriggerKey } from '../auth/store.js'
import { withSpinner } from '../utils/spinner.js'
import { extractUuidFromFilename } from '../utils/slug.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { runCommand } from '../utils/exec.js'
import { createTempPlaywrightConfig } from '../utils/playwright.js'
import { ensureDependenciesForTestType, DependencyError } from '../utils/deps.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'

const VALID_JOB_TYPES = ['playwright', 'k6'] as const

export const jobCommand = new Command('job')
  .description('Manage jobs')

type LocalJobTest = {
  path: string
  type: 'playwright' | 'k6'
  name: string
  script: string
}

function inferLocalTestType(filePath: string): 'playwright' | 'k6' {
  return filePath.endsWith('.k6.ts') || filePath.endsWith('.k6.js') ? 'k6' : 'playwright'
}

function toDisplayName(cwd: string, filePath: string): string {
  const normalized = filePath.replace(cwd, '').replace(/^\//, '')
  return normalized.startsWith('_supercheck_/') ? normalized.replace(/^_supercheck_\//, '') : normalized
}

function resolveJobLocalTests(
  cwd: string,
  tests: string[],
  patterns: { playwright?: string; k6?: string },
): LocalJobTest[] {
  const files = discoverFiles(cwd, patterns)
  const uuidMap = new Map<string, string>()
  for (const file of files) {
    const uuid = extractUuidFromFilename(file.absolutePath)
    if (uuid) uuidMap.set(uuid, file.absolutePath)
  }

  return tests.map((ref) => {
    let resolved: string | undefined

    if (ref.endsWith('.pw.ts') || ref.endsWith('.k6.ts') || ref.endsWith('.pw.js') || ref.endsWith('.k6.js')) {
      resolved = resolve(cwd, ref)
    } else if (ref.startsWith('_supercheck_/')) {
      resolved = resolve(cwd, ref)
    } else if (uuidMap.has(ref)) {
      resolved = uuidMap.get(ref)
    }

    if (!resolved) {
      throw new CLIError(`Cannot resolve local test for job entry: ${ref}`, ExitCode.ConfigError)
    }

    const script = readFileSync(resolved, 'utf-8')
    const type = inferLocalTestType(resolved)
    return { path: resolved, type, name: toDisplayName(cwd, resolved), script }
  })
}

async function validateJobTests(
  client: ReturnType<typeof createAuthenticatedClient>,
  tests: LocalJobTest[],
): Promise<void> {
  // Fast client-side script-type mismatch detection
  for (const test of tests) {
    const declaredType = normalizeTestTypeForApi(test.type)
    const mismatch = validateScriptTypeMatch(test.script, declaredType)
    if (mismatch) {
      throw new CLIError(`${test.name}: ${mismatch}`, ExitCode.ConfigError)
    }
  }

  const inputs = tests.map((test) => ({
    name: test.name,
    script: test.script,
    testType: normalizeTestTypeForApi(test.type),
  }))

  const results = await validateScripts(client, inputs)
  const failures = results.filter((r) => !r.valid)
  if (failures.length > 0) {
    const details = failures.map((f) => `  - ${f.name}: ${f.error ?? 'Validation failed'}`).join('\n')
    throw new CLIError(`Validation failed:\n${details}`, ExitCode.ConfigError)
  }
}

async function runLocalJobTests(
  tests: LocalJobTest[],
  cwd: string,
  testMatch?: string,
): Promise<void> {
  const playwrightTests = tests.filter((t) => t.type === 'playwright').map((t) => t.path)
  const k6Tests = tests.filter((t) => t.type === 'k6').map((t) => t.path)

  // Pre-flight dependency checks
  try {
    if (playwrightTests.length > 0) {
      ensureDependenciesForTestType(cwd, 'playwright')
    }
    if (k6Tests.length > 0) {
      ensureDependenciesForTestType(cwd, 'k6')
    }
  } catch (err) {
    if (err instanceof DependencyError) {
      throw new CLIError(err.message, ExitCode.GeneralError)
    }
    throw err
  }

  if (playwrightTests.length > 0) {
    logger.header('Running Playwright tests')
    const tempConfig = createTempPlaywrightConfig(cwd, testMatch)
    try {
      const code = await runCommand('npx', ['playwright', 'test', '--config', tempConfig.path, ...playwrightTests], cwd)
      if (code !== 0) {
        throw new CLIError(`Playwright tests failed with exit code ${code}`, ExitCode.GeneralError)
      }
    } finally {
      tempConfig.cleanup()
    }
  }

  for (const path of k6Tests) {
    logger.header(`Running k6 test: ${toDisplayName(cwd, path)}`)
    const code = await runCommand('k6', ['run', path], cwd)
    if (code !== 0) {
      throw new CLIError(`k6 test failed with exit code ${code}`, ExitCode.GeneralError)
    }
  }
}

jobCommand
  .command('list')
  .description('List all jobs')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '50')
  .action(async (options: { page: string; limit: string }) => {
    const client = createAuthenticatedClient()

    const { data } = await withSpinner(
      'Fetching jobs',
      () => client.get<PaginatedResponse<Record<string, unknown>>>(
        '/api/jobs',
        { page: options.page, limit: options.limit },
      ),
    )

    output(data.data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'status', header: 'Status' },
        { key: 'cronSchedule', header: 'Schedule' },
        { key: 'createdAt', header: 'Created' },
      ],
    })

    outputPagination(data.pagination)
  })

const keysCommand = jobCommand
  .command('keys')
  .description('Manage job trigger keys')

keysCommand
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching trigger keys',
      () => client.get<{ success: boolean; apiKeys: Array<Record<string, unknown>> }>(
        `/api/jobs/${jobId}/api-keys`,
      ),
    )

    output(data.apiKeys ?? [], {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'start', header: 'Prefix' },
        { key: 'enabled', header: 'Enabled' },
        { key: 'expiresAt', header: 'Expires' },
        { key: 'lastRequest', header: 'Last used' },
      ],
    })
  })

keysCommand
  .command('create')
  .description('Create a new trigger key for a job')
  .argument('<jobId>', 'Job ID')
  .requiredOption('--name <name>', 'Key name')
  .option('--expires-in <seconds>', 'Expiry in seconds (min 60)')
  .action(async (jobId: string, options: { name: string; expiresIn?: string }) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = { name: options.name }
    if (options.expiresIn !== undefined) {
      body.expiresIn = parseIntStrict(options.expiresIn, '--expires-in', { min: 60 })
    }

    const { data } = await withSpinner(
      'Creating trigger key',
      () => client.post<{ success: boolean; apiKey: Record<string, unknown> }>(
        `/api/jobs/${jobId}/api-keys`,
        body,
      ),
    )

    logger.success('Trigger key created')
    logger.warn('Save the `key` value now. It will only be shown once.')
    outputDetail(data.apiKey)
  })

keysCommand
  .command('delete')
  .description('Revoke a trigger key')
  .argument('<jobId>', 'Job ID')
  .argument('<keyId>', 'Key ID')
  .action(async (jobId: string, keyId: string) => {
    const client = createAuthenticatedClient()
    await withSpinner(
      'Revoking trigger key',
      () => client.delete(`/api/jobs/${jobId}/api-keys/${keyId}`),
    )
    logger.success(`Trigger key ${keyId} revoked`)
  })

jobCommand
  .command('get <id>')
  .description('Get job details')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching job details',
      () => client.get<Record<string, unknown>>(`/api/jobs/${id}`),
    )
    outputDetail(data)
  })

jobCommand
  .command('create')
  .description('Create a new job')
  .requiredOption('--name <name>', 'Job name')
  .requiredOption('--tests <tests...>', 'Test IDs (space or comma separated)')
  .option('--description <description>', 'Job description', '')
  .option('--type <type>', 'Job runner type (playwright, k6)')
  .option('--schedule <cron>', 'Cron schedule expression')
  .option('--dry-run', 'Show what would be sent without creating')
  .action(async (options: { name: string; tests: string[]; description: string; type?: string; schedule?: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()

    const tests = (options.tests ?? [])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)

    if (tests.length === 0) {
      throw new CLIError('At least one test ID is required to create a job.', ExitCode.ConfigError)
    }

    const body: Record<string, unknown> = {
      name: options.name,
      description: options.description,
      tests: tests.map((id) => ({ id })),
    }
    if (options.type) {
      const type = options.type.trim().toLowerCase()
      if (!VALID_JOB_TYPES.includes(type as typeof VALID_JOB_TYPES[number])) {
        throw new CLIError(
          `Invalid value for --type: "${options.type}". Expected one of: ${VALID_JOB_TYPES.join(', ')}.`,
          ExitCode.ConfigError,
        )
      }
      body.jobType = type
    }
    if (options.schedule) body.cronSchedule = options.schedule

    if (options.dryRun) {
      logger.header('Dry run \u2014 job create payload:')
      logger.info(JSON.stringify(body, null, 2))
      return
    }

    const { data } = await withSpinner(
      'Creating job',
      () => client.post<Record<string, unknown>>('/api/jobs', body),
    )
    const job = (data as Record<string, unknown> & { job?: Record<string, unknown> }).job ?? data
    const jobId = (job as Record<string, unknown>)?.id
    logger.success(`Job "${options.name}" created (${jobId ?? 'unknown'})`)
    outputDetail(job as Record<string, unknown>)
  })

jobCommand
  .command('update <id>')
  .description('Update job configuration')
  .option('--name <name>', 'Job name')
  .option('--description <description>', 'Job description')
  .option('--schedule <cron>', 'Cron schedule expression')
  .option('--status <status>', '[deprecated] Job status is runtime state and cannot be updated via the CLI')
  .option('--dry-run', 'Show what would be sent without updating')
  .action(async (id: string, options: { name?: string; description?: string; schedule?: string; status?: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = {}
    if (options.name !== undefined) body.name = options.name
    if (options.description !== undefined) body.description = options.description
    if (options.schedule !== undefined) body.cronSchedule = options.schedule
    if (options.status !== undefined) {
      logger.warn('Ignoring --status: job status is runtime state and is not editable via the current API.')
    }

    if (Object.keys(body).length === 0) {
      logger.warn('No fields to update. Use --name, --description, or --schedule.')
      return
    }

    if (options.dryRun) {
      logger.header('Dry run \u2014 job update payload:')
      logger.info(JSON.stringify(body, null, 2))
      return
    }

    const { data } = await withSpinner(
      'Updating job',
      () => client.patch<Record<string, unknown>>(`/api/jobs/${id}`, body),
    )
    logger.success(`Job ${id} updated`)
    outputDetail(data)
  })

jobCommand
  .command('delete <id>')
  .description('Delete a job')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      const confirmed = await confirmPrompt(`Delete job ${id}?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting job',
      () => client.delete(`/api/jobs/${id}`),
    )
    logger.success(`Job ${id} deleted`)
  })

jobCommand
  .command('run')
  .description('Run a job immediately')
  .requiredOption('--id <id>', 'Job ID to run')
  .option('--local', 'Run locally')
  .option('--cloud', 'Run on cloud')
  .action(async (options: { id: string; local?: boolean; cloud?: boolean }) => {
    if (options.local && options.cloud) {
      throw new CLIError('--local and --cloud are mutually exclusive.', ExitCode.ConfigError)
    }

    const useLocal = options.local === true

    if (useLocal) {
      const cwd = process.cwd()
      const { config } = await loadConfig({ cwd })
      const job = config.jobs?.find((j) => j.id === options.id || j.name === options.id)

      if (!job) {
        throw new CLIError(`Job ${options.id} not found in local config.`, ExitCode.ConfigError)
      }

      const tests = Array.isArray(job.tests) ? job.tests : []
      if (tests.length === 0) {
        throw new CLIError(`Job ${options.id} has no tests.`, ExitCode.GeneralError)
      }

      const patterns = {
        playwright: config.tests?.playwright?.testMatch,
        k6: config.tests?.k6?.testMatch,
      }

      const localTests = resolveJobLocalTests(cwd, tests, patterns)

      const client = createAuthenticatedClient()
      await withSpinner('Validating test scripts...', async () => {
        await validateJobTests(client, localTests)
      }, { successText: 'Test scripts validated' })

      await runLocalJobTests(localTests, cwd, config.tests?.playwright?.testMatch)
      return
    }

    const client = createAuthenticatedClient()

    const { data: jobData } = await withSpinner(
      'Fetching job details',
      () => client.get<{ tests?: Array<{ id: string; name?: string; title?: string }> }>(
        `/api/jobs/${options.id}`,
      ),
    )

    const tests = Array.isArray(jobData.tests) ? jobData.tests : []
    if (tests.length === 0) {
      throw new CLIError(
        `Job ${options.id} has no tests. Add tests to the job before running it.`,
        ExitCode.GeneralError,
      )
    }

    const payloadTests = tests.map((test) => ({
      id: test.id,
      name: test.name ?? test.title ?? '',
    }))

    const { data } = await withSpinner(
      'Running job',
      () => client.post<{ runId: string; message: string }>(
        '/api/jobs/run',
        { jobId: options.id, tests: payloadTests, trigger: 'remote' },
      ),
    )

    logger.success(`Job started. Run ID: ${data.runId}`)
    outputDetail(data as Record<string, unknown>)
  })

jobCommand
  .command('trigger <id>')
  .description('Trigger a job run')
  .option('--wait', 'Wait for the run to complete')
  .option('--timeout <seconds>', 'Maximum wait time in seconds', '300')
  .action(async (id: string, options: { wait?: boolean; timeout: string }) => {
    const triggerClient = new ApiClient({
      token: requireTriggerKey(),
      baseUrl: getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? undefined,
    })

    const { data } = await withSpinner(
      'Triggering job',
      () => triggerClient.post<{ runId: string; message: string }>(
        `/api/jobs/${id}/trigger`,
      ),
    )

    const runId = (data as { runId?: string; data?: { runId?: string } }).runId
      ?? (data as { data?: { runId?: string } }).data?.runId
    if (!runId) {
      throw new CLIError('Job trigger response did not include a run ID.', ExitCode.ApiError)
    }

    logger.success(`Job triggered. Run ID: ${runId}`)

    if (options.wait) {
      let statusClient: ReturnType<typeof createAuthenticatedClient>
      try {
        statusClient = createAuthenticatedClient()
      } catch {
        throw new CLIError(
          'Waiting for completion requires a CLI token. Set SUPERCHECK_TOKEN (sck_live_* or sck_test_).',
          ExitCode.AuthError,
        )
      }

      logger.info('Waiting for run to complete...')
      const timeoutMs = parseIntStrict(options.timeout, '--timeout', { min: 1 }) * 1000
      const startTime = Date.now()

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 3000))

        const { data: runData } = await statusClient.get<{ status: string }>(
          `/api/runs/${runId}`,
        )

        const status = typeof runData.status === 'string' ? runData.status.toLowerCase() : ''

        if (['passed', 'failed', 'error', 'blocked'].includes(status)) {
          if (status === 'passed') {
            logger.success(`Run ${runId} passed`)
          } else if (status === 'blocked') {
            logger.error(`Run ${runId} blocked`)
            throw new CLIError(`Run ${runId} blocked`, ExitCode.GeneralError)
          } else {
            logger.error(`Run ${runId} ${status}`)
            throw new CLIError(`Run ${runId} ${status}`, ExitCode.GeneralError)
          }
          outputDetail(runData as Record<string, unknown>)
          return
        }

        logger.debug(`Run status: ${status || '(unknown)'}`)
      }

      throw new CLIError(
        `Timed out waiting for run to complete after ${options.timeout}s`,
        ExitCode.Timeout,
      )
    }
  })
