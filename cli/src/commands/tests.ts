import { waitForRun } from '../utils/wait.js'
import { parseIntStrict } from '../utils/number.js'
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { discoverFiles } from '../utils/discovery.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputMutation, outputPagination } from '../output/formatter.js'
import { requirePriority } from '../utils/priority.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import type { PaginatedResponse } from '../api/client.js'
import { withSpinner } from '../utils/spinner.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { runCommand } from '../utils/exec.js'
import { createTempPlaywrightConfig } from '../utils/playwright.js'
import { ensureDependenciesForTestType, DependencyError } from '../utils/deps.js'
import { getSse } from '../utils/sse.js'
import { decodeStoredTestScript, encodeStoredTestScript } from '../utils/script.js'
import { stripTitleMetadata } from '../utils/slug.js'
import type { ApiTestType } from '../utils/validation.js'
import { addAssignedTags, getAssignedTags, removeAssignedTags } from '../utils/tag-assignment.js'

export const requireTestPriority = requirePriority

function normalizeTestType(input: string): string {
  return requireApiTestType(input, '--type')
}

function requireApiTestType(input: string, optionName: string): ApiTestType {
  const normalized = normalizeTestTypeForApi(input)
  if (!normalized) {
    throw new CLIError(
      `Invalid value for ${optionName}: "${input}". Expected one of: browser, performance, api, database, custom.`,
      ExitCode.ConfigError,
    )
  }
  return normalized
}

function inferTestType(filename: string): string | undefined {
  if (filename.endsWith('.k6.ts') || filename.endsWith('.k6.js')) return 'k6'
  if (filename.endsWith('.pw.ts') || filename.endsWith('.pw.js') || filename.endsWith('.spec.ts')) return 'playwright'
  return undefined
}

type LocalTestFile = {
  path: string
  type: 'playwright' | 'k6'
  name: string
  script: string
  validationType?: ReturnType<typeof normalizeTestTypeForApi>
}

function toDisplayName(cwd: string, filePath: string): string {
  const local = relative(cwd, filePath)
  const normalized = local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local) ? filePath : local
  return normalized.startsWith('_supercheck_/') ? normalized.replace(/^_supercheck_\//, '') : normalized
}

function collectLocalTests(
  cwd: string,
  patterns: { playwright?: string; k6?: string },
  options: { file?: string; all?: boolean; type?: string },
): LocalTestFile[] {
  if (options.type) {
    const raw = options.type.trim().toLowerCase()
    if (raw === 'api' || raw === 'database' || raw === 'custom') {
      throw new CLIError(
        `Local test execution only supports "browser" and "performance" tests. "${raw}" tests are executed remotely.`,
        ExitCode.ConfigError,
      )
    }
  }

  if (options.file) {
    const filePath = resolve(cwd, options.file)
    const isK6 = options.type === 'k6' || options.type === 'performance'
    const type = inferTestType(filePath) ?? (isK6 ? 'k6' : 'playwright')
    const validationType = options.type
      ? requireApiTestType(options.type, '--type')
      : normalizeTestTypeForApi(type)
    let script: string
    try { script = readFileSync(filePath, 'utf-8') } catch { throw new CLIError(`Cannot read local test: ${filePath}`, ExitCode.ConfigError) }
    return [{
      path: filePath,
      type: type as 'playwright' | 'k6',
      name: toDisplayName(cwd, filePath),
      script,
      validationType,
    }]
  }

  const requestedType = options.type ? requireApiTestType(options.type, '--type') : undefined
  const filterType = requestedType
    ? requestedType === 'performance' ? 'k6' : 'playwright'
    : undefined

  const files = discoverFiles(cwd, patterns)
    .filter((file) => !filterType || file.type === filterType)

  return files.map((file) => {
    const script = readFileSync(file.absolutePath, 'utf-8')
    const validationType = requestedType ?? normalizeTestTypeForApi(file.type)
    return {
      path: file.absolutePath,
      type: file.type,
      name: toDisplayName(cwd, file.absolutePath),
      script,
      validationType,
    }
  })
}

async function validateLocalTests(client: ReturnType<typeof createAuthenticatedClient>, tests: LocalTestFile[]): Promise<void> {
  // First: fast client-side script-type mismatch detection
  for (const test of tests) {
    const declaredType = test.validationType ?? normalizeTestTypeForApi(test.type)
    const mismatch = validateScriptTypeMatch(test.script, declaredType)
    if (mismatch) {
      throw new CLIError(`${test.name}: ${mismatch}`, ExitCode.ConfigError)
    }
  }

  // Then: server-side validation (security patterns, AST, etc.)
  const inputs = tests.map((test) => ({
    name: test.name,
    script: test.script,
    testType: test.validationType ?? normalizeTestTypeForApi(test.type),
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
}

async function runPlaywrightTests(paths: string[], cwd: string, browser?: string, configPath?: string): Promise<void> {
  if (paths.length === 0) return
  const tempConfig = createTempPlaywrightConfig(cwd, paths.map((path) => path.replace(/\\/g, '/')), browser, configPath)
  try {
    const code = await runCommand('npx', ['playwright', 'test', '--config', tempConfig.path, ...(getOutputFormat() === 'json' ? ['--reporter=json'] : []), ...paths], cwd)
    if (code !== 0) {
      throw new CLIError(`Playwright tests failed with exit code ${code}`, ExitCode.GeneralError)
    }
  } finally {
    tempConfig.cleanup()
  }
}

async function runK6Tests(paths: string[], cwd: string): Promise<void> {
  for (const path of paths) {
    const code = await runCommand('k6', ['run', path], cwd)
    if (code !== 0) {
      throw new CLIError(`k6 test failed with exit code ${code}`, ExitCode.GeneralError)
    }
  }
}

export const testCommand = new Command('test')
  .description('Manage tests')

testCommand
  .command('list')
  .description('List all tests')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '50')
  .option('--search <query>', 'Search by title')
  .option('--type <type>', 'Filter by type (browser, performance, api, database, custom)')
  .option('--priority <priority>', 'Filter by priority (low, medium, high)')
  .action(async (options: { page: string; limit: string; search?: string; type?: string; priority?: string }) => {
    const client = createAuthenticatedClient()

    const params: Record<string, string> = {
      page: options.page,
      limit: options.limit,
    }
    if (options.search) params.search = options.search
    if (options.type) params.type = normalizeTestType(options.type)
    if (options.priority) params.priority = requireTestPriority(options.priority)

    const { data } = await withSpinner(
      'Fetching tests',
      () => client.get<PaginatedResponse<Record<string, unknown>>>(
        '/api/tests',
        params,
      ),
    )

    output(data.data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'title', header: 'Title' },
        { key: 'type', header: 'Type' },
        { key: 'priority', header: 'Priority' },
        { key: 'createdAt', header: 'Created' },
      ],
    })

    outputPagination(data.pagination)
  })

testCommand
  .command('get <id>')
  .description('Get test details')
  .option('--include-script', 'Include the test script content')
  .action(async (id: string, options: { includeScript?: boolean }) => {
    const client = createAuthenticatedClient()
    const params: Record<string, string> = {
      includeScript: options.includeScript ? 'true' : 'false',
    }

    const { data } = await withSpinner(
      'Fetching test details',
      () => client.get<Record<string, unknown>>(`/api/tests/${id}`, params),
    )
    outputDetail(data)
    if (options.includeScript && getOutputFormat() === 'table' && typeof data.script === 'string') logger.output(decodeStoredTestScript(data.script) ?? '')
  })

testCommand
  .command('create')
  .description('Create a new test')
  .requiredOption('--title <title>', 'Test title')
  .requiredOption('--file <path>', 'Path to the test script file')
  .option('--type <type>', 'Test type (browser, performance, api, database, custom)')
  .option('--description <description>', 'Test description')
  .option('--priority <priority>', 'Test priority (low, medium, high)')
  .option('--dry-run', 'Show what would be sent without creating')
  .action(async (options: { title: string; file: string; type?: string; description?: string; priority?: string; dryRun?: boolean }) => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')

    const filePath = resolve(process.cwd(), options.file)
    let script: string

    try {
      script = readFileSync(filePath, 'utf-8')
    } catch {
      throw new CLIError(`Cannot read file: ${filePath}`, ExitCode.ConfigError)
    }

    const typeArg = options.type || inferTestType(options.file) || 'playwright'

    // Validate script content matches declared type before sending to API
    const typeMismatchError = validateScriptTypeMatch(script, normalizeTestTypeForApi(typeArg))
    if (typeMismatchError) {
      throw new CLIError(typeMismatchError, ExitCode.ConfigError)
    }

    const encodedScript = encodeStoredTestScript(stripTitleMetadata(script))

    const body: Record<string, unknown> = {
      title: options.title,
      script: encodedScript,
      type: normalizeTestType(typeArg),
    }
    if (options.description) body.description = options.description
    if (options.priority !== undefined) body.priority = requireTestPriority(options.priority)

    if (options.dryRun) {
      const preview = { ...body, script: `<base64 ${encodedScript.length} chars>` }
      logger.header('Dry run \u2014 test create payload:')
      outputDetail({ dryRun: true, payload: preview })
      return
    }

    const client = createAuthenticatedClient()

    const { data } = await withSpinner(
      'Creating test',
      () => client.post<Record<string, unknown>>('/api/tests', body),
    )
    const createdId =
      (data as { test?: { id?: string } }).test?.id ??
      (data as { id?: string }).id
    logger.success(`Test "${options.title}" created${createdId ? ` (${createdId})` : ''}`)
    outputDetail(data)
  })

testCommand
  .command('update <id>')
  .description('Update a test')
  .option('--title <title>', 'Test title')
  .option('--file <path>', 'Path to updated test script')
  .option('--type <type>', 'Test type (browser, performance, api, database, custom)')
  .option('--description <description>', 'Test description')
  .option('--priority <priority>', 'Test priority (low, medium, high)')
  .option('--dry-run', 'Show what would be sent without updating')
  .action(async (id: string, options: { title?: string; file?: string; type?: string; description?: string; priority?: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = {}
    if (options.title !== undefined) body.title = options.title
    if (options.description !== undefined) body.description = options.description
    if (options.priority !== undefined) body.priority = requireTestPriority(options.priority)
    if (options.type !== undefined) body.type = requireApiTestType(options.type, '--type')

    if (options.file) {
      const { readFileSync } = await import('node:fs')
      const { resolve } = await import('node:path')
      const filePath = resolve(process.cwd(), options.file)
      let raw: string

      try {
        raw = readFileSync(filePath, 'utf-8')
      } catch {
        throw new CLIError(`Cannot read file: ${filePath}`, ExitCode.GeneralError)
      }

      const effectiveType = (() => {
        if (typeof body.type === 'string') {
          return body.type as ApiTestType
        }
        return undefined
      })()

      if (!effectiveType) {
        const { data: existing } = await client.get<{ type?: string }>(`/api/tests/${id}`, {
          includeScript: 'false',
        })
        const existingType = typeof existing.type === 'string'
          ? normalizeTestTypeForApi(existing.type)
          : undefined
        const mismatch = validateScriptTypeMatch(raw, existingType)
        if (mismatch) {
          throw new CLIError(mismatch, ExitCode.ConfigError)
        }
      } else {
        const mismatch = validateScriptTypeMatch(raw, effectiveType)
        if (mismatch) {
          throw new CLIError(mismatch, ExitCode.ConfigError)
        }
      }

      body.script = encodeStoredTestScript(stripTitleMetadata(raw))
    }

    if (Object.keys(body).length === 0) {
      throw new CLIError('No fields to update. Use --title, --file, --description, --type, or --priority.', ExitCode.ConfigError)
    }

    if (options.dryRun) {
      const preview = { ...body }
      if (typeof preview.script === 'string') {
        preview.script = `<base64 ${(preview.script as string).length} chars>`
      }
      logger.header('Dry run \u2014 test update payload:')
      outputDetail({ dryRun: true, payload: preview })
      return
    }

    const { data } = await withSpinner(
      'Updating test',
      () => client.patch<Record<string, unknown>>(`/api/tests/${id}`, body),
    )
    logger.success(`Test ${id} updated`)
    outputDetail(data)
  })

testCommand
  .command('delete <id>')
  .description('Delete a test')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Delete test ${id}?`, { default: false })
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting test',
      () => client.delete(`/api/tests/${id}`),
    )
    logger.success(`Test ${id} deleted`)
    outputMutation({ id, deleted: true })
  })

testCommand
  .command('run')
  .description('Run tests locally')
  .option('--file <path>', 'Local test file path')
  .option('--offline', 'Run locally without credentials or server validation')
  .option('--playwright-config <path>', 'Use an existing Playwright config')
  .option('--all', 'Run all local tests')
  .option('--type <type>', 'Test type filter (browser, performance)')
  .action(async (options: { file?: string; all?: boolean; type?: string; offline?: boolean; playwrightConfig?: string }) => {

    if (!options.file && !options.all) {
      throw new CLIError('Local runs require --file <path> or --all.', ExitCode.ConfigError)
    }

    const cwd = process.cwd()
    const { config } = await loadConfig({ cwd, offline: options.offline, allowMissing: options.offline })

    const patterns = {
      playwright: config.tests?.playwright?.testMatch,
      k6: config.tests?.k6?.testMatch,
    }

    const localTests = collectLocalTests(cwd, patterns, {
      file: options.file,
      all: options.all,
      type: options.type,
    })

    if (localTests.length === 0) {
      logger.warn('No local tests found to run.')
      return
    }

    if (!options.offline) await validateLocalTests(createAuthenticatedClient(), localTests)
    else for (const test of localTests) {
      const mismatch = validateScriptTypeMatch(test.script, test.validationType)
      if (mismatch) throw new CLIError(mismatch, ExitCode.ConfigError)
    }

    const playwrightTests = localTests.filter((t) => t.type === 'playwright').map((t) => t.path)
    const k6Tests = localTests.filter((t) => t.type === 'k6').map((t) => t.path)

    // Pre-flight dependency checks
    try {
      if (playwrightTests.length > 0) {
        ensureDependenciesForTestType(cwd, 'playwright', options.playwrightConfig ? null : config.tests?.playwright?.browser)
      }
      if (k6Tests.length > 0) {
        ensureDependenciesForTestType(cwd, 'k6')
      }
    } catch (err) {
      if (err instanceof DependencyError) {
        throw new CLIError(err.message, ExitCode.ConfigError)
      }
      throw err
    }

    if (playwrightTests.length > 0) {
      logger.header('Running Playwright tests')
      await runPlaywrightTests(playwrightTests, cwd, config.tests?.playwright?.browser, options.playwrightConfig)
    }

    if (k6Tests.length > 0) {
      logger.header('Running k6 tests')
      await runK6Tests(k6Tests, cwd)
    }
  })

const TAG_COLUMNS = [
  { key: 'id', header: 'ID' },
  { key: 'name', header: 'Name' },
  { key: 'color', header: 'Color' },
]

testCommand
  .command('tags <id>')
  .description('Get test tags')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const data = await withSpinner('Fetching test tags', () => getAssignedTags(client, `/api/tests/${encodeURIComponent(id)}`))
    output(data as unknown as Record<string, unknown>[], { columns: TAG_COLUMNS })
  })

const testTagCommand = testCommand
  .command('tag')
  .description('Assign or remove tags on a test')

testTagCommand
  .command('add <id> <tags...>')
  .description('Add tags (names or IDs) to a test, keeping its existing tags')
  .action(async (id: string, refs: string[]) => {
    const client = createAuthenticatedClient()
    const data = await withSpinner('Adding test tags', () => addAssignedTags(client, `/api/tests/${encodeURIComponent(id)}`, refs))
    logger.success(`Test ${id} now has ${data.length} tag(s)`)
    output(data as unknown as Record<string, unknown>[], { columns: TAG_COLUMNS })
  })

testTagCommand
  .command('remove <id> <tags...>')
  .description('Remove tags (names or IDs) from a test')
  .action(async (id: string, refs: string[]) => {
    const client = createAuthenticatedClient()
    const data = await withSpinner('Removing test tags', () => removeAssignedTags(client, `/api/tests/${encodeURIComponent(id)}`, refs))
    logger.success(`Test ${id} now has ${data.length} tag(s)`)
    output(data as unknown as Record<string, unknown>[], { columns: TAG_COLUMNS })
  })

testCommand
  .command('validate')
  .description('Validate a test script')
  .requiredOption('--file <path>', 'Path to the test script file')
  .option('--type <type>', 'Test type (browser, performance, api, database, custom)')
  .action(async (options: { file: string; type?: string }) => {
    const cwd = process.cwd()
    const filePath = resolve(cwd, options.file)
    let script: string

    try {
      script = readFileSync(filePath, 'utf-8')
    } catch {
      throw new CLIError(`Cannot read file: ${filePath}`, ExitCode.GeneralError)
    }

    const typeArg = options.type || inferTestType(options.file) || 'playwright'

    // Fast client-side check for script-type mismatch
    const resolvedApiType = options.type
      ? requireApiTestType(options.type, '--type')
      : normalizeTestTypeForApi(typeArg)
    const typeMismatchError = validateScriptTypeMatch(script, resolvedApiType)
    if (typeMismatchError) {
      throw new CLIError(typeMismatchError, ExitCode.ConfigError)
    }

    const client = createAuthenticatedClient()

    const results = await withSpinner(
      'Validating script',
      () => validateScripts(client, [{
        name: toDisplayName(cwd, filePath),
        script,
        testType: normalizeTestTypeForApi(typeArg),
      }]),
    )

    const result = results[0]
    if (getOutputFormat() === 'json') outputDetail({ ...result, type: typeArg })
    if (result?.valid) {
      logger.success(`Script is valid (${typeArg})`)
      if (result.warnings && result.warnings.length > 0) {
        logger.warn(`Warnings: ${result.warnings.join(', ')}`)
      }
      return
    }

    throw new CLIError(`Script validation failed: ${result?.error ?? 'Unknown error'}`, ExitCode.ConfigError)
  })

testCommand
  .command('status <id>')
  .description('Stream live status events for a test')
  .option('--idle-timeout <seconds>', 'Abort if no data received within this period', '60')
  .action(async (id: string, options: { idleTimeout: string }) => {
    await getSse(`/api/test-status/events/${id}`, ({ data }) => {
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (getOutputFormat() === 'json') logger.output(JSON.stringify(record))
      else outputDetail(record)
      const status = String(record.derivedStatus ?? record.status)
      if (['failed', 'error', 'blocked'].includes(status)) {
        throw new CLIError(String(record.errorDetails ?? `Test ended with status: ${status}`), ExitCode.GeneralError)
      }
    }, Math.max(Number(options.idleTimeout) || 60, 10) * 1000)
  })

testCommand.command('execute <id>')
  .description('Execute one deployed test in the cloud')
  .option('--location <code>', 'Execution location for performance tests')
  .option('--wait', 'Wait for the run to complete')
  .option('--timeout <seconds>', 'Maximum wait time', '300')
  .action(async (id: string, options: { location?: string; wait?: boolean; timeout: string }) => {
    const timeout = parseIntStrict(options.timeout, '--timeout', { min: 1 }) * 1000
    const client = createAuthenticatedClient()
    const { data } = await client.post<Record<string, unknown>>(`/api/tests/${id}/execute`, { ...(options.location ? { location: options.location } : {}) }, { retries: 0 })
    const runId = data.runId
    if (typeof runId !== 'string') throw new CLIError('Execution returned no run ID. Inspect runs before retrying.', ExitCode.ApiError)
    if (options.wait) {
      try { outputDetail(await waitForRun(client, runId, timeout)) }
      catch (error) { throw new CLIError(error instanceof Error ? error.message : 'Waiting failed', error instanceof CLIError ? error.exitCode : ExitCode.ApiError, { runId }) }
    } else outputDetail({ ...data, runId, status: 'accepted' })
  })
