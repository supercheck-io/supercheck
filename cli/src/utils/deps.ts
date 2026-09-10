import { execFileSync, execSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import pc from 'picocolors'
import { logger } from './logger.js'

export interface DependencyStatus {
  name: string
  installed: boolean
  version?: string
  detail?: string
  required: boolean
  installHint: string
}

/**
 * Check if a command is available on PATH.
 */
export function isCommandAvailable(command: string): { available: boolean; version?: string } {
  try {
    const output = execFileSync(command, ['--version'], {
      stdio: 'pipe',
      timeout: 10_000,
      env: { ...process.env },
    }).toString().trim()

    // Extract first line only
    const version = output.split('\n')[0].trim()
    return { available: true, version }
  } catch {
    return { available: false }
  }
}

function getPlaywrightBrowserDirs(cwd: string): string[] {
  const configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim()
  if (configuredPath) {
    if (configuredPath === '0') {
      return [
        resolve(cwd, 'node_modules', 'playwright-core', '.local-browsers'),
        resolve(cwd, 'node_modules', 'playwright', '.local-browsers'),
      ]
    }
    return [resolve(configuredPath)]
  }

  const home = homedir()
  const dirs = [
    resolve(cwd, 'node_modules', 'playwright-core', '.local-browsers'),
    resolve(cwd, 'node_modules', 'playwright', '.local-browsers'),
  ]

  switch (process.platform) {
    case 'darwin':
      dirs.push(join(home, 'Library', 'Caches', 'ms-playwright'))
      break
    case 'linux':
      dirs.push(join(home, '.cache', 'ms-playwright'))
      break
    case 'win32': {
      const base = process.env.LOCALAPPDATA
        ? resolve(process.env.LOCALAPPDATA)
        : join(home, 'AppData', 'Local')
      dirs.push(join(base, 'ms-playwright'))
      break
    }
  }

  return dirs
}

/**
 * Check if the default Playwright browser runtime is installed.
 * The CLI executes local tests with Playwright's default browser selection,
 * so we require at least one Chromium browser bundle to be present.
 */
export function arePlaywrightBrowsersInstalled(cwd: string): boolean {
  for (const dir of getPlaywrightBrowserDirs(cwd)) {
    if (!existsSync(dir)) continue

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      const hasChromium = entries.some((entry) => {
        if (!entry.isDirectory()) return false
        return entry.name.startsWith('chromium-') || entry.name.startsWith('chromium_headless_shell-')
      })

      if (hasChromium) {
        return true
      }
    } catch {
      // Ignore unreadable cache locations and keep checking fallbacks.
    }
  }

  return false
}

/**
 * Check if @playwright/test is installed as a dependency in the project.
 */
export function isPlaywrightPackageInstalled(cwd: string): boolean {
  try {
    const pkgPath = resolve(cwd, 'node_modules', '@playwright', 'test', 'package.json')
    return existsSync(pkgPath)
  } catch {
    return false
  }
}

/**
 * Check if k6 binary is available on PATH.
 */
export function isK6Installed(): { installed: boolean; version?: string } {
  const result = isCommandAvailable('k6')
  return { installed: result.available, version: result.version }
}

/**
 * Check if Node.js is available (should always be true if running).
 */
export function isNodeInstalled(): { installed: boolean; version?: string } {
  return { installed: true, version: process.version }
}

/**
 * Install Playwright browsers (chromium by default).
 * Returns true if installation was successful.
 *
 * SECURITY: Browser parameter is validated against allowlist to prevent command injection.
 */
export async function installPlaywrightBrowsers(cwd: string, browser = 'chromium'): Promise<boolean> {
  try {
    // SECURITY FIX: Validate browser parameter against allowlist
    const allowedBrowsers = ['chromium', 'firefox', 'webkit',  'chrome', 'msedge']
    if (!allowedBrowsers.includes(browser)) {
      logger.error(`Invalid browser: ${browser}. Allowed: ${allowedBrowsers.join(', ')}`)
      return false
    }

    logger.info(`Installing Playwright ${browser} browser...`)
    // SECURITY: Safe to use browser parameter - validated above
    execSync(`npx playwright install ${browser}`, {
      cwd,
      stdio: 'inherit',
      timeout: 300_000, // 5 min timeout for browser download
      env: { ...process.env },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Run all dependency checks and return a summary.
 */
export function checkAllDependencies(cwd: string): DependencyStatus[] {
  const deps: DependencyStatus[] = []

  // Node.js
  const node = isNodeInstalled()
  deps.push({
    name: 'Node.js',
    installed: node.installed,
    version: node.version,
    required: true,
    installHint: 'https://nodejs.org/',
  })

  // @playwright/test npm package
  const pwPkg = isPlaywrightPackageInstalled(cwd)
  deps.push({
    name: '@playwright/test',
    installed: pwPkg,
    detail: pwPkg ? 'npm package found' : 'npm package not found',
    required: true,
    installHint: 'npm install --save-dev @playwright/test',
  })

  // Playwright browsers (chromium)
  if (pwPkg) {
    const browsersInstalled = arePlaywrightBrowsersInstalled(cwd)
    deps.push({
      name: 'Playwright browsers',
      installed: browsersInstalled,
      detail: browsersInstalled ? 'chromium browser available' : 'run: npx playwright install chromium',
      required: true,
      installHint: 'npx playwright install chromium',
    })
  } else {
    deps.push({
      name: 'Playwright browsers',
      installed: false,
      detail: 'install @playwright/test first',
      required: true,
      installHint: 'npm install --save-dev @playwright/test && npx playwright install chromium',
    })
  }

  // k6 binary
  const k6 = isK6Installed()
  deps.push({
    name: 'k6',
    installed: k6.installed,
    version: k6.version,
    detail: k6.installed ? undefined : 'needed for performance tests',
    required: false,
    installHint: getK6InstallHint(),
  })

  return deps
}

/**
 * Get platform-specific k6 installation instructions.
 */
export function getK6InstallHint(): string {
  const platform = process.platform
  switch (platform) {
    case 'darwin':
      return 'brew install k6'
    case 'linux':
      return 'sudo snap install k6 or see https://grafana.com/docs/k6/latest/set-up/install-k6/'
    case 'win32':
      return 'choco install k6 or winget install k6'
    default:
      return 'https://grafana.com/docs/k6/latest/set-up/install-k6/'
  }
}

/**
 * Format dependency check results for display.
 */
export function formatDependencyReport(deps: DependencyStatus[]): string {
  const lines: string[] = []
  let allGood = true

  for (const dep of deps) {
    const icon = dep.installed ? pc.green('✓') : dep.required ? pc.red('✗') : pc.yellow('○')
    const name = dep.installed ? dep.name : pc.dim(dep.name)
    const version = dep.version ? pc.dim(` (${dep.version})`) : ''
    const detail = dep.detail && !dep.installed ? pc.dim(` — ${dep.detail}`) : ''

    lines.push(`  ${icon} ${name}${version}${detail}`)

    if (!dep.installed && dep.required) {
      allGood = false
      lines.push(`    ${pc.dim('Install:')} ${dep.installHint}`)
    } else if (!dep.installed && !dep.required) {
      lines.push(`    ${pc.dim('Install (optional):')} ${dep.installHint}`)
    }
  }

  if (allGood) {
    lines.push('')
    lines.push(pc.green('  All required dependencies are installed!'))
  }

  return lines.join('\n')
}

/**
 * Check if required dependencies for a specific test type are available.
 * Throws CLIError with helpful message if missing.
 */
export function ensureDependenciesForTestType(
  cwd: string,
  testType: 'playwright' | 'k6',
): void {
  if (testType === 'playwright') {
    if (!isPlaywrightPackageInstalled(cwd)) {
      throw new DependencyError(
        'playwright',
        '@playwright/test is not installed.\n' +
        '  Install it with: npm install --save-dev @playwright/test\n' +
        '  Then install browsers: npx playwright install chromium',
      )
    }

    if (!arePlaywrightBrowsersInstalled(cwd)) {
      throw new DependencyError(
        'playwright-browsers',
        'Playwright browsers are not installed.\n' +
        '  Install them with: npx playwright install chromium',
      )
    }
  }

  if (testType === 'k6') {
    const k6 = isK6Installed()
    if (!k6.installed) {
      throw new DependencyError(
        'k6',
        `k6 is not installed.\n` +
        `  Install it with: ${getK6InstallHint()}\n` +
        `  Documentation: https://grafana.com/docs/k6/latest/set-up/install-k6/`,
      )
    }
  }
}

/**
 * Error thrown when a required dependency is missing.
 */
export class DependencyError extends Error {
  public readonly dependency: string

  constructor(dependency: string, message: string) {
    super(message)
    this.name = 'DependencyError'
    this.dependency = dependency
  }
}
