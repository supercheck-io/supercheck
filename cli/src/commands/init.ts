import { Command } from 'commander'
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { logger } from '../utils/logger.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { detectPackageManager, ensurePackageJson, installDependencies } from '../utils/package-manager.js'
import { installPlaywrightBrowsers, isK6Installed, getK6InstallHint } from '../utils/deps.js'
import { uuidv7 } from '../utils/uuid.js'
import { slugify } from '../utils/slug.js'

const CONFIG_TEMPLATE = `import { defineConfig } from '@supercheck/cli'

export default defineConfig({
  schemaVersion: '1.0',
  project: {
    organization: 'my-org',
    project: 'my-project',
  },
  api: {
    baseUrl: process.env.SUPERCHECK_URL ?? 'https://app.supercheck.io',
  },
  tests: {
    playwright: {
      testMatch: '_supercheck_/playwright/**/*.pw.ts',
      browser: 'chromium',
    },
    k6: {
      testMatch: '_supercheck_/k6/**/*.k6.ts',
    },
  },
})
`

const EXAMPLE_PW_TEST = `// @title Homepage Check

import { test, expect } from '@playwright/test'

test('homepage loads successfully', async ({ page }) => {
  await page.goto('https://example.com')
  await expect(page).toHaveTitle(/Example/)
})
`

const EXAMPLE_K6_TEST = `// @title Load Test

import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 10,
  duration: '30s',
}

export default function () {
  const res = http.get('https://example.com')
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  })
  sleep(1)
}
`

const SUPERCHECK_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node", "k6"]
  },
  "include": [
    "supercheck.config.ts",
    "supercheck.config.local.ts",
    "_supercheck_/**/*.ts"
  ]
}
`

const GITIGNORE_ADDITIONS = `
# Supercheck CLI
supercheck.config.local.ts
supercheck.config.local.js
supercheck.config.local.mjs
`

export const initCommand = new Command('init')
  .description('Initialize a new Supercheck project with config and example tests')
  .option('--force', 'Overwrite existing config file')
  .option('--skip-install', 'Skip automatic dependency installation')
  .option('--skip-examples', 'Skip creating example test files')
  .option('--pm <manager>', 'Package manager to use (npm, yarn, pnpm, bun)')
  .action(async (options: { force?: boolean; skipInstall?: boolean; skipExamples?: boolean; pm?: string }) => {
    const cwd = process.cwd()
    const requestedPm = options.pm?.trim().toLowerCase()
    if (requestedPm && !['npm', 'yarn', 'pnpm', 'bun'].includes(requestedPm)) {
      throw new CLIError(
        `Invalid value for --pm: "${options.pm}". Expected one of: npm, yarn, pnpm, bun.`,
        ExitCode.ConfigError,
      )
    }

    const configPath = resolve(cwd, 'supercheck.config.ts')
    if (existsSync(configPath) && !options.force) {
      throw new CLIError(
        'supercheck.config.ts already exists. Use --force to overwrite.',
        ExitCode.ConfigError,
      )
    }

    logger.newline()
    logger.header('Initializing Supercheck project...')
    logger.newline()

    // 1. Write supercheck.config.ts
    writeFileSync(configPath, CONFIG_TEMPLATE, 'utf-8')
    logger.success('Created supercheck.config.ts')

    // 2. Write tsconfig.supercheck.json for IDE IntelliSense
    const tsconfigPath = resolve(cwd, 'tsconfig.supercheck.json')
    if (!existsSync(tsconfigPath) || options.force) {
      writeFileSync(tsconfigPath, SUPERCHECK_TSCONFIG, 'utf-8')
      logger.success('Created tsconfig.supercheck.json (IDE IntelliSense)')
    }

    // 3. Create _supercheck_/ directory structure
    const supercheckDir = resolve(cwd, '_supercheck_')
    const playwrightDir = resolve(supercheckDir, 'playwright')
    const k6Dir = resolve(supercheckDir, 'k6')
    for (const dir of [supercheckDir, playwrightDir, k6Dir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
    logger.success('Created _supercheck_/ directory structure')

    // 4. Create example test files (unless --skip-examples)
    //    Uses UUID v7 filenames to match the server's ID format, preventing
    //    duplicate tests on deploy → pull round-trips.
    if (!options.skipExamples) {
      const pwTitle = 'Homepage Check'
      const pwId = uuidv7()
      const pwSlug = slugify(pwTitle)
      const pwFilename = `${pwSlug}.${pwId}.pw.ts`
      const pwTestPath = resolve(cwd, `_supercheck_/playwright/${pwFilename}`)
      if (!existsSync(pwTestPath)) {
        writeFileSync(pwTestPath, EXAMPLE_PW_TEST, 'utf-8')
        logger.success(`Created _supercheck_/playwright/${pwFilename} (Playwright example)`)
      }

      const k6Title = 'Load Test'
      const k6Id = uuidv7()
      const k6Slug = slugify(k6Title)
      const k6Filename = `${k6Slug}.${k6Id}.k6.ts`
      const k6TestPath = resolve(cwd, `_supercheck_/k6/${k6Filename}`)
      if (!existsSync(k6TestPath)) {
        writeFileSync(k6TestPath, EXAMPLE_K6_TEST, 'utf-8')
        logger.success(`Created _supercheck_/k6/${k6Filename} (k6 example)`)
      }
    }

    // 5. Update .gitignore
    const gitignorePath = resolve(cwd, '.gitignore')
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, 'utf-8')
      if (!content.includes('supercheck.config.local')) {
        appendFileSync(gitignorePath, GITIGNORE_ADDITIONS, 'utf-8')
        logger.success('Updated .gitignore with Supercheck entries')
      }
    }

    // 6. Detect package manager
    const pm = (requestedPm as 'npm' | 'yarn' | 'pnpm' | 'bun' | undefined) ?? detectPackageManager(cwd)
    logger.debug(`Detected package manager: ${pm}`)

    // 7. Ensure package.json exists
    const createdPkg = ensurePackageJson(cwd)
    if (createdPkg) {
      logger.success('Created package.json')
    }

    // 8. Install dependencies
    await installDependencies(cwd, pm, {
      packages: options.skipExamples ? ['@supercheck/cli', 'typescript', '@types/node', '@types/k6'] : ['@supercheck/cli', 'typescript', '@types/node', '@playwright/test', '@types/k6'],
      skipInstall: options.skipInstall ?? false,
    })

    // 9. Install Playwright browsers (chromium) — needed for local test execution
    if (!options.skipInstall && !options.skipExamples) {
      logger.newline()
      const browserInstalled = await installPlaywrightBrowsers(cwd, 'chromium')
      if (browserInstalled) {
        logger.success('Playwright chromium browser installed')
      } else {
        logger.warn('Could not install Playwright browsers automatically.')
        logger.info('  Run manually: npx playwright install chromium')
      }
    }

    // 10. Check for k6 (optional, for performance tests)
    const k6Status = isK6Installed()

    logger.newline()
    logger.header('Supercheck project initialized!')
    logger.newline()

    if (!k6Status.installed) {
      logger.warn('k6 is not installed (needed for performance/load tests)')
      logger.info(`  Install: ${getK6InstallHint()}`)
      logger.info('  Docs: https://grafana.com/docs/k6/latest/set-up/install-k6/')
      logger.newline()
    }

    logger.info('Next steps:')
    logger.info('  1. Edit supercheck.config.ts with your org/project details')
    logger.info('  2. Run `supercheck login --token <your-token>` to authenticate')
    logger.info('  3. Write tests in _supercheck_/playwright and _supercheck_/k6')
    logger.info('  4. Run `supercheck diff` to preview changes against the cloud')
    logger.info('  5. Run `supercheck deploy` to push to Supercheck')
    logger.info('  6. Run `supercheck pull` to sync cloud resources locally')
    logger.newline()
    logger.info('Useful commands:')
    logger.info('  supercheck pull        Pull tests & config from the cloud')
    logger.info('  supercheck diff        Preview local vs remote differences')
    logger.info('  supercheck deploy      Push local config to Supercheck')
    logger.info('  supercheck whoami      Check authentication status')
    logger.newline()
  })
