import { existsSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { logger } from './logger.js'
import { CLIError, ExitCode } from './errors.js'
import { withSpinner } from './spinner.js'

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
 * Get the install command for dev dependencies based on the detected package manager.
 */
function getInstallCommand(pm: 'npm' | 'yarn' | 'pnpm' | 'bun', packages: string[]): string {
  const pkgs = packages.join(' ')
  switch (pm) {
    case 'bun': return `bun add -d ${pkgs}`
    case 'pnpm': return `pnpm add -D ${pkgs}`
    case 'yarn': return `yarn add -D ${pkgs}`
    case 'npm': return `npm install --save-dev ${pkgs}`
  }
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
  if (opts.skipInstall) {
    logger.info('Skipping dependency installation')
    return
  }

  const devDeps = opts.packages ?? ['@supercheck/cli', 'typescript', '@types/node']
  const cmd = getInstallCommand(pm, devDeps)

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
