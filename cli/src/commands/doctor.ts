import { Command } from 'commander'
import { logger } from '../utils/logger.js'
import { checkAllDependencies, formatDependencyReport, installPlaywrightBrowsers } from '../utils/deps.js'
import { getOutputFormat } from '../output/formatter.js'
import { discoverRepository } from '../utils/discover.js'
import { readConfigIdentity } from '../utils/link-config.js'
import { readSmallFile } from '../utils/safe-read.js'
import { resolve } from 'node:path'
import { getStoredBaseUrl, isAuthenticated } from '../auth/store.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import pc from '../utils/colors.js'

export const doctorCommand = new Command('doctor')
  .description('Check that all dependencies and configuration are set up correctly')
  .option('--fix', 'Attempt to automatically fix missing dependencies')
  .action(async (options: { fix?: boolean }) => {
    const cwd = process.cwd()
    const format = getOutputFormat()

    logger.newline()
    logger.header('Supercheck Doctor')
    logger.newline()

    // Determine project requirements (Playwright vs k6 vs monitors only) by READING the config as text. The config
    // is code, and a repository you are diagnosing may be untrusted, so `doctor` never executes it or loads its .env.
    const facts = discoverRepository(cwd)
    const configFile = facts.existingTests.supercheck.config
    const configText = configFile ? readSmallFile(resolve(cwd, configFile)) : null
    const configResult = configText === null ? null : { text: configText, identity: readConfigIdentity(configText) }
    const hasPlaywrightConfig = configText !== null && /\bplaywright\s*:\s*\{/.test(configText)
    const hasK6Config = configText !== null && /\bk6\s*:\s*\{/.test(configText)
    const requirePlaywright = hasPlaywrightConfig
    const requireK6 = hasK6Config
    const browserMatch = configText === null ? null : /\bbrowser\s*:\s*(["'`])(chromium|firefox|webkit)\1/.exec(configText)
    const browser = (browserMatch?.[2] ?? 'chromium') as 'chromium' | 'firefox' | 'webkit'

    // 1. Check dependencies
    logger.info(pc.bold('Dependencies:'))
    let deps = checkAllDependencies(cwd, { requirePlaywright, requireK6, browser })

    if (format === 'table') logger.info(formatDependencyReport(deps))

    logger.newline()

    // 2. Check authentication
    logger.info(pc.bold('Authentication:'))
    const hasAuth = isAuthenticated()
    if (hasAuth) {
      const baseUrl = getStoredBaseUrl() ?? 'https://app.supercheck.io'
      logger.info(`  ${pc.green('✓')} Authenticated (${pc.dim(baseUrl)})`)
    } else {
      logger.info(`  ${pc.yellow('○')} Not authenticated — run: supercheck login`)
    }

    logger.newline()

    // 3. Configuration summary
    logger.info(pc.bold('Configuration:'))
    if (configResult) {
      logger.info(`  ${pc.green('✓')} supercheck.config.ts found`)
      const org = configResult.identity.organization
      const proj = configResult.identity.project
      if (org && proj && org !== 'my-org' && proj !== 'my-project') {
        logger.info(`  ${pc.green('✓')} Project: ${pc.dim(`${org}/${proj}`)}`)
      } else {
        logger.info(`  ${pc.yellow('○')} Project org/project not configured in supercheck.config.ts (run: supercheck link)`)
      }
    } else {
      logger.info(`  ${pc.yellow('○')} No supercheck.config.ts — run: supercheck init`)
    }

    logger.newline()

    // 4. Auto-fix if requested
    let missingRequired = deps.filter((d) => !d.installed && d.required)
    if (options.fix && missingRequired.length > 0) {
      logger.header('Attempting to fix missing dependencies...')
      logger.newline()

      for (const dep of missingRequired) {
        if (dep.name === 'Playwright browsers') {
          const ok = await installPlaywrightBrowsers(cwd, browser)
          if (ok) {
            logger.success('Playwright browsers installed')
          } else {
            logger.error(`Failed to install Playwright browsers. Run manually: ${dep.installHint}`)
          }
        } else if (dep.name === '@playwright/test') {
          logger.info(`Install @playwright/test:`)
          logger.info(`  ${dep.installHint}`)
        }
      }
      logger.newline()

      // Re-check dependencies after attempting fixes
      deps = checkAllDependencies(cwd, { requirePlaywright, requireK6, browser })
      missingRequired = deps.filter((d) => !d.installed && d.required)
    }

    // 5. Summary
    if (missingRequired.length === 0 && hasAuth && configResult) {
      logger.success('Everything looks good! You\'re ready to use Supercheck.')
    } else {
      const issues: string[] = []
      if (missingRequired.length > 0) {
        issues.push(`${missingRequired.length} missing required dependency(s)`)
      }
      if (!hasAuth) {
        issues.push('not authenticated')
      }
      if (!configResult) {
        issues.push('no config file')
      }
      logger.warn(`Issues found: ${issues.join(', ')}`)

      if (!options.fix && missingRequired.length > 0) {
        logger.info(`Run ${pc.bold('supercheck doctor --fix')} to attempt automatic fixes.`)
      }
    }

    logger.newline()

    if (format === 'json') logger.output(JSON.stringify({
      dependencies: deps,
      authenticated: hasAuth,
      authenticationVerified: false,
      localReady: missingRequired.length === 0,
      cloudCredentialsPresent: hasAuth,
      apiUrl: getStoredBaseUrl() ?? 'https://app.supercheck.io',
      configFound: Boolean(configResult),
      ready: missingRequired.length === 0 && hasAuth && Boolean(configResult),
    }, null, 2))

    // Exit with error code if required deps are missing
    if (missingRequired.length > 0) {
      throw new CLIError(
        `Missing ${missingRequired.length} required dependency(s). Run 'supercheck doctor --fix' or install manually.`,
        ExitCode.ConfigError,
      )
    }
  })
