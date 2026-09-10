import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { discoverFiles } from '../utils/discovery.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import type { PaginatedResponse } from '../api/client.js'
import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { CLI_VERSION } from '../version.js'
import { withSpinner } from '../utils/spinner.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { runCommand } from '../utils/exec.js'
import { createTempPlaywrightConfig } from '../utils/playwright.js'
import { ensureDependenciesForTestType, DependencyError } from '../utils/deps.js'
import { getProxyAgent, getProxyEnv } from '../utils/proxy.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'
import { encodeStoredTestScript } from '../utils/script.js'
import type { ApiTestType } from '../utils/validation.js'

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
  const normalized = filePath.replace(cwd, '').replace(/^\//, '')
  return normalized.startsWith('_supercheck_/') ? normalized.replace(/^_supercheck_\//, '') : normalized
}

function collectLocalTests(
  cwd: string,
  patterns: { playwright?: string; k6?: string },
  options: { file?: string; all?: boolean; type?: string },
): LocalTestFile[] {
  if (options.file) {
    const filePath = resolve(cwd, options.file)
    const type = inferTestType(filePath) ?? (options.type === 'k6' ? 'k6' : 'playwright')
    const validationType = options.type
      ? requireApiTestType(options.type, '--type')
      : normalizeTestTypeForApi(type)
    const script = readFileSync(filePath, 'utf-8')
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

async function runPlaywrightTests(paths: string[], cwd: string, testMatch?: string): Promise<void> {
  if (paths.length === 0) return
  const tempConfig = createTempPlaywrightConfig(cwd, testMatch)
  try {
    const code = await runCommand('npx', ['playwright', 'test', '--config', tempConfig.path, ...paths], cwd)
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
  .action(async (options: { page: string; limit: string; search?: string; type?: string }) => {
    const client = createAuthenticatedClient()

    const params: Record<string, string> = {
      page: options.page,
      limit: options.limit,
    }
    if (options.search) params.search = options.search
    if (options.type) params.type = normalizeTestType(options.type)

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
  })

testCommand
  .command('create')
  .description('Create a new test')
  .requiredOption('--title <title>', 'Test title')
  .requiredOption('--file <path>', 'Path to the test script file')
  .option('--type <type>', 'Test type (browser, performance, api, database, custom)')
  .option('--description <description>', 'Test description')
  .option('--dry-run', 'Show what would be sent without creating')
  .action(async (options: { title: string; file: string; type?: string; description?: string; dryRun?: boolean }) => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')

    const filePath = resolve(process.cwd(), options.file)
    let script: string

    try {
      script = readFileSync(filePath, 'utf-8')
    } catch {
      throw new CLIError(`Cannot read file: ${filePath}`, ExitCode.GeneralError)
    }

    const typeArg = options.type || inferTestType(options.file) || 'playwright'

    // Validate script content matches declared type before sending to API
    const typeMismatchError = validateScriptTypeMatch(script, normalizeTestTypeForApi(typeArg))
    if (typeMismatchError) {
      throw new CLIError(typeMismatchError, ExitCode.ConfigError)
    }

    const encodedScript = encodeStoredTestScript(script)

    const body: Record<string, unknown> = {
      title: options.title,
      script: encodedScript,
      type: normalizeTestType(typeArg),
    }
    if (options.description) body.description = options.description

    if (options.dryRun) {
      const preview = { ...body, script: `<base64 ${encodedScript.length} chars>` }
      logger.header('Dry run \u2014 test create payload:')
      logger.info(JSON.stringify(preview, null, 2))
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
  .option('--dry-run', 'Show what would be sent without updating')
  .action(async (id: string, options: { title?: string; file?: string; type?: string; description?: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = {}
    if (options.title !== undefined) body.title = options.title
    if (options.description !== undefined) body.description = options.description
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

      body.script = encodeStoredTestScript(raw)
    }

    if (Object.keys(body).length === 0) {
      logger.warn('No fields to update. Use --title, --file, or --description.')
      return
    }

    if (options.dryRun) {
      const preview = { ...body }
      if (typeof preview.script === 'string') {
        preview.script = `<base64 ${(preview.script as string).length} chars>`
      }
      logger.header('Dry run \u2014 test update payload:')
      logger.info(JSON.stringify(preview, null, 2))
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
      const confirmed = await confirmPrompt(`Delete test ${id}?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting test',
      () => client.delete(`/api/tests/${id}`),
    )
    logger.success(`Test ${id} deleted`)
  })

testCommand
  .command('run')
  .description('Run tests locally')
  .option('--file <path>', 'Local test file path')
  .option('--all', 'Run all local tests')
  .option('--type <type>', 'Test type filter (browser, performance, api, database, custom)')
  .action(async (options: { file?: string; all?: boolean; type?: string }) => {

    if (!options.file && !options.all) {
      throw new CLIError('Local runs require --file <path> or --all.', ExitCode.ConfigError)
    }

    const cwd = process.cwd()
    const { config } = await loadConfig({ cwd })
    const client = createAuthenticatedClient()
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

    await withSpinner('Validating test scripts...', async () => {
      await validateLocalTests(client, localTests)
    }, { successText: 'Test scripts validated' })

    const playwrightTests = localTests.filter((t) => t.type === 'playwright').map((t) => t.path)
    const k6Tests = localTests.filter((t) => t.type === 'k6').map((t) => t.path)

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
        throw new CLIError(err.message, ExitCode.ConfigError)
      }
      throw err
    }

    if (playwrightTests.length > 0) {
      logger.header('Running Playwright tests')
      await runPlaywrightTests(playwrightTests, cwd, config.tests?.playwright?.testMatch)
    }

    if (k6Tests.length > 0) {
      logger.header('Running k6 tests')
      await runK6Tests(k6Tests, cwd)
    }
  })

testCommand
  .command('tags <id>')
  .description('Get test tags')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching test tags',
      () => client.get<Record<string, unknown>[]>(`/api/tests/${id}/tags`),
    )
    output(data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'color', header: 'Color' },
      ],
    })
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
    if (result?.valid) {
      logger.success(`Script is valid (${typeArg})`)
      if (result.warnings && result.warnings.length > 0) {
        logger.warn(`Warnings: ${result.warnings.join(', ')}`)
      }
      return
    }

    throw new CLIError(`Script validation failed: ${result?.error ?? 'Unknown error'}`, ExitCode.GeneralError)
  })

testCommand
  .command('status <id>')
  .description('Stream live status events for a test')
  .option('--idle-timeout <seconds>', 'Abort if no data received within this period', '60')
  .action(async (id: string, options: { idleTimeout: string }) => {
    const token = requireAuth()
    const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
    const idleTimeoutMs = Math.max(Number(options.idleTimeout) || 60, 10) * 1000

    const url = `${baseUrl}/api/test-status/events/${id}`
    const parsedUrl = new URL(url)

    logger.info(`Streaming status for test ${id}...`)
    logger.newline()

    const controller = new AbortController()
    const connectTimeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const proxy = getProxyEnv(parsedUrl)
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
          'User-Agent': `supercheck-cli/${CLI_VERSION}`,
        },
        ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
        signal: controller.signal,
      })

      clearTimeout(connectTimeout)

      if (!response.ok) {
        throw new CLIError(`Failed to connect to status stream: ${response.status}`, ExitCode.ApiError)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new CLIError('No response body for SSE stream', ExitCode.ApiError)
      }

      const decoder = new TextDecoder()
      let buffer = ''

      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
      }
      resetIdleTimer()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        resetIdleTimer()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith(':')) continue
          if (line.startsWith('data: ')) {
            const payload = line.slice(6)
            try {
              const parsed = JSON.parse(payload) as Record<string, unknown>
              outputDetail(parsed)
            } catch {
              process.stdout.write(payload + '\n')
            }
          }
        }
      }

      if (idleTimer) clearTimeout(idleTimer)
    } catch (err) {
      if (err instanceof CLIError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CLIError(
          `Stream timed out (no data received for ${Math.round(idleTimeoutMs / 1000)}s)`,
          ExitCode.Timeout,
        )
      }
      throw new CLIError(
        `Stream error: ${err instanceof Error ? err.message : String(err)}`,
        ExitCode.ApiError,
      )
    }
  })
