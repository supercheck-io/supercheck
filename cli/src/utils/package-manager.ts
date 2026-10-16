import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { logger } from './logger.js'
import { CLIError, ExitCode } from './errors.js'
import { withSpinner } from './spinner.js'
import { CLI_VERSION } from '../version.js'

/**
 * Detect the package manager used in the project.
 * Checks for lock files in order of priority.
 */
export function detectPackageManager(cwd: string): 'npm' | 'yarn' | 'pnpm' | 'bun' {
  if (existsSync(resolve(cwd, 'bun.lockb')) || existsSync(resolve(cwd, 'bun.lock'))) return 'bun'
  if (existsSync(resolve(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(resolve(cwd, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

/**
 * Get the install command. The manifest already declares the scaffold's
 * dependencies, so install from it; naming packages would rewrite the ranges.
 */
function getInstallCommand(pm: 'npm' | 'yarn' | 'pnpm' | 'bun'): string {
  return `${pm} install`
}

/**
 * Ensure a package.json exists. If not, create a minimal one.
 * Returns true if a new file was created, false if it already existed.
 */
export function ensurePackageJson(cwd: string): boolean {
  const pkgPath = resolve(cwd, 'package.json')
  if (existsSync(pkgPath)) return false

  const projectName = basename(cwd).toLowerCase().replace(/[^a-z0-9-]/g, '-')

  const minimalPkg = {
    name: projectName,
    private: true,
    type: 'module',
    scripts: {
      'supercheck:deploy': 'supercheck deploy',
      'supercheck:diff': 'supercheck diff',
      'supercheck:pull': 'supercheck pull',
      'supercheck:test': 'supercheck test',
    },
  }

  writeFileSync(pkgPath, JSON.stringify(minimalPkg, null, 2) + '\n', 'utf-8')
  return true
}

// Known-good ranges for the scaffold's dev dependencies (an unpinned `*` would
// make a later fresh install non-reproducible).
const DEFAULT_RANGES: Record<string, string> = {
  typescript: '^5.7.3',
  '@types/node': '^22.13.0',
  '@types/k6': '^2.3.0',
  '@playwright/test': '^1.50.0',
}

const isRecord = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v)

function declareDependencies(pkgPath: string, names: string[]): void {
  let raw: string
  let pkg: Record<string, unknown>
  try {
    raw = readFileSync(pkgPath, 'utf-8')
    const parsed: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (!isRecord(parsed)) throw new Error('not an object')
    pkg = parsed
  } catch {
    throw new CLIError(`Cannot read ${pkgPath}: it must contain a valid JSON object.`, ExitCode.ConfigError)
  }
  if (pkg.devDependencies !== undefined && !isRecord(pkg.devDependencies)) {
    throw new CLIError(`Cannot update ${pkgPath}: "devDependencies" must be an object.`, ExitCode.ConfigError)
  }
  const dev: Record<string, string> = isRecord(pkg.devDependencies) ? pkg.devDependencies : {}
  const present = (name: string) =>
    [pkg.dependencies, pkg.optionalDependencies, dev].some((d) => isRecord(d) && d[name])
  let changed = false
  for (const name of names) {
    if (present(name)) continue
    dev[name] = name === '@supercheck/cli' && CLI_VERSION !== '0.0.0-dev' ? `^${CLI_VERSION}` : (DEFAULT_RANGES[name] ?? 'latest')
    changed = true
  }
  if (!changed) return
  pkg.devDependencies = dev
  const indent = /^[ \t]+(?=")/m.exec(raw)?.[0] ?? 2
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  // Write beside the manifest, then rename, so an interrupted write cannot truncate it.
  const tmpPath = `${pkgPath}.${process.pid}.tmp`
  writeFileSync(tmpPath, JSON.stringify(pkg, null, indent).replace(/\n/g, eol) + eol, 'utf-8')
  renameSync(tmpPath, pkgPath)
}

/**
 * Install dev dependencies required for Supercheck tests.
 */
export async function installDependencies(
  cwd: string,
  pm: 'npm' | 'yarn' | 'pnpm' | 'bun',
  opts: {
    packages?: string[],
    skipInstall?: boolean
  } = {}
): Promise<void> {
  const devDeps = opts.packages ?? ['@supercheck/cli', 'typescript', '@types/node']
  declareDependencies(resolve(cwd, 'package.json'), devDeps)

  if (opts.skipInstall) {
    logger.info(`Skipping dependency installation. Run \`${pm} install\` before using this project.`)
    return
  }

  const cmd = getInstallCommand(pm)

  logger.info(`Installing dependencies with ${pm}...`)
  logger.debug(`Running: ${cmd}`)

  await withSpinner(
    `Installing ${devDeps.length} packages...`,
    async () => {
      const { execSync } = await import('node:child_process')
      try {
        execSync(cmd, {
          cwd,
          stdio: 'pipe',
          timeout: 120_000, // 2 minute timeout
          env: { ...process.env, NODE_ENV: 'development' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new CLIError(
          `Failed to install dependencies. Run manually:\n  ${cmd}\n\nError: ${message}`,
          ExitCode.GeneralError,
        )
      }
    },
    { successText: 'Dependencies installed' },
  )
}

/**
 * Check if k6 is installed and available in the PATH.
 */
export async function checkK6Binary(): Promise<boolean> {
  const { execSync } = await import('node:child_process')
  try {
    execSync('k6 version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
