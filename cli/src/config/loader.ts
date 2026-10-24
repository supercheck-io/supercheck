import { loadProjectEnv } from './project-env.js'
import { createJiti } from 'jiti'
import { deepmergeCustom } from 'deepmerge-ts'
import { existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { supercheckConfigSchema, type SupercheckConfig } from './schema.js'
import { CLIError, ConfigNotFoundError, ConfigurationError, ExitCode } from '../utils/errors.js'

const CONFIG_FILES = [
  'supercheck.config.ts',
  'supercheck.config.js',
  'supercheck.config.mjs',
]

const LOCAL_CONFIG_FILES = [
  'supercheck.config.local.ts',
  'supercheck.config.local.js',
  'supercheck.config.local.mjs',
]

/**
 * Resolve the config file path. Search order:
 * 1. Explicit --config flag
 * 2. supercheck.config.{ts,js,mjs} in cwd
 */
function resolveConfigPath(cwd: string, explicitPath?: string): string | null {
  if (explicitPath) {
    const abs = resolve(cwd, explicitPath)
    if (!existsSync(abs)) {
      throw new CLIError(
        `Config file not found: ${abs}`,
        ExitCode.ConfigError,
      )
    }
    return abs
  }

  for (const file of CONFIG_FILES) {
    const abs = resolve(cwd, file)
    if (existsSync(abs)) return abs
  }

  return null
}

/**
 * Resolve local override config file path.
 */
function resolveLocalConfigPath(cwd: string): string | null {
  for (const file of LOCAL_CONFIG_FILES) {
    const abs = resolve(cwd, file)
    if (existsSync(abs)) return abs
  }
  return null
}

/**
 * Load a TS/JS config file using jiti (zero-config TS execution).
 */
async function loadConfigFile(filePath: string): Promise<unknown> {
  const jiti = createJiti(dirname(filePath), {
    interopDefault: true,
  })

  let mod: Record<string, unknown>
  try {
    mod = await jiti.import(filePath) as Record<string, unknown>
  } catch (err) {
    // `init --skip-install` leaves a config that imports the CLI package before it is installed.
    if (err instanceof Error && /Cannot find (module|package) '@supercheck\/cli'/.test(err.message)) {
      throw new ConfigurationError(`${basename(filePath)} imports @supercheck/cli, which is not installed here. Run \`npm install\` first.`)
    }
    throw new ConfigurationError(`Cannot load ${basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`)
  }
  return mod.default ?? mod
}

/**
 * Apply environment variable overrides to the config.
 */
function applyEnvOverrides(config: SupercheckConfig): SupercheckConfig {
  const result = { ...config }

  if (process.env.SUPERCHECK_URL) {
    result.api = {
      ...result.api,
      baseUrl: process.env.SUPERCHECK_URL,
    }
  }

  if (process.env.SUPERCHECK_ORG) {
    result.project = {
      ...result.project,
      organization: process.env.SUPERCHECK_ORG,
    }
  }

  if (process.env.SUPERCHECK_PROJECT) {
    result.project = {
      ...result.project,
      project: process.env.SUPERCHECK_PROJECT,
    }
  }

  return result
}

/**
 * Detect secrets in config values that should never be stored in config files.
 * Checks for all token formats including legacy `job_` prefix trigger keys.
 */
function validateNoSecrets(config: SupercheckConfig): void {
  const configStr = JSON.stringify(config)
  const secretPatterns = [
    /sck_live_[a-zA-Z0-9]+/,
    /sck_trigger_[a-zA-Z0-9]+/,
    /sck_test_[a-zA-Z0-9]+/,
    // Legacy trigger key format: job_ followed by 32+ hex chars
    /job_[a-fA-F0-9]{32,}/,
  ]

  for (const pattern of secretPatterns) {
    if (pattern.test(configStr)) {
      throw new CLIError(
        'Config file contains what appears to be an API token. ' +
        'Tokens must be stored in environment variables (SUPERCHECK_TOKEN) or the OS keychain, never in config files.',
        ExitCode.ConfigError,
      )
    }
  }
}

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
  offline?: boolean
  allowMissing?: boolean
}

export interface LoadConfigResult {
  config: SupercheckConfig
  configPath: string | null
  /** `api.baseUrl` as written in the config files, before SUPERCHECK_URL overrides it; used for the wrong-target guard. */
  declaredBaseUrl?: string
}

/**
 * Load, merge, validate, and return the Supercheck configuration.
 *
 * Priority (highest to lowest):
 * 1. Environment variables
 * 2. supercheck.config.local.{ts,js,mjs}
 * 3. supercheck.config.{ts,js,mjs}
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadConfigResult> {
  const cwd = options.cwd ?? process.cwd()

  // Load .env file if present (quiet: true suppresses injection logs)
  loadProjectEnv(resolve(cwd, '.env'))

  const configPath = resolveConfigPath(cwd, options.configPath)
  if (!configPath) {
    if (options.offline && options.allowMissing) return { config: { schemaVersion: '1.0', project: { organization: 'local', project: 'local' }, tests: { playwright: { testMatch: '_supercheck_/playwright/**/*.pw.ts', browser: 'chromium' }, k6: { testMatch: '_supercheck_/k6/**/*.k6.ts' } } }, configPath: null }
    throw new ConfigNotFoundError()
  }

  let config = await loadConfigFile(configPath) as SupercheckConfig

  const localConfigPath = resolveLocalConfigPath(cwd)
  if (localConfigPath) {
    const localConfig = await loadConfigFile(localConfigPath) as Partial<SupercheckConfig>
    const mergeLocalConfig = deepmergeCustom({ mergeArrays: false })
    config = mergeLocalConfig(config, localConfig) as SupercheckConfig
  }

  if (options.offline && !config.project) config = { ...config, project: { organization: 'local', project: 'local' } }
  const declaredBaseUrl = config.api?.baseUrl
  config = applyEnvOverrides(config)

  validateNoSecrets(config)

  const parsed = supercheckConfigSchema.safeParse(config)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n')
    throw new CLIError(
      `Invalid configuration:\n${issues}`,
      ExitCode.ConfigError,
    )
  }

  return {
    config: parsed.data,
    configPath,
    declaredBaseUrl,
  }
}

/**
 * Try to load config, but return null if no config file exists.
 * Used by commands that don't strictly require a config (e.g., login, health).
 */
export async function tryLoadConfig(options: LoadConfigOptions = {}): Promise<LoadConfigResult | null> {
  try {
    return await loadConfig(options)
  } catch (err) {
    if (err instanceof ConfigNotFoundError) {
      return null
    }
    throw err
  }
}
