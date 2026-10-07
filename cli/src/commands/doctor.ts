import { Command } from 'commander'
import { logger } from '../utils/logger.js'
import { checkAllDependencies, formatDependencyReport, installPlaywrightBrowsers } from '../utils/deps.js'
import { getOutputFormat } from '../output/formatter.js'
import { tryLoadConfig } from '../config/loader.js'
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

    // Load config first to determine project requirements (Playwright vs k6 vs monitors only)
    const configResult = await tryLoadConfig()
    const hasPlaywrightConfig = configResult?.config.tests?.playwright !== undefined
    const hasK6Config = configResult?.config.tests?.k6 !== undefined
    const requirePlaywright = hasPlaywrightConfig
    const requireK6 = hasK6Config

    // 1. Check dependencies
    logger.info(pc.bold('Dependencies:'))
    let deps = checkAllDependencies(cwd, { requirePlaywright, requireK6 })

    if (format === 'table') logger.info(formatDependencyReport(deps))

    logger.newline()

    // 2. Check authentication
    logger.info(pc.bold('Authentication:'))
    const hasAuth = isAuthenticated()
    if (hasAuth) {
      const baseUrl = getStoredBaseUrl() ?? 'https://app.supercheck.io'
      logger.info(`  ${pc.green('✓')} Authenticated (${pc.dim(baseUrl)})`)
    } else {
      logger.info(`  ${pc.yellow('○')} Not authenticated — run: supercheck login --token <token>`)
    }

    logger.newline()

    // 3. Configuration summary
    logger.info(pc.bold('Configuration:'))
    if (configResult) {
      logger.info(`  ${pc.green('✓')} supercheck.config.ts found`)
      const org = configResult.config.project?.organization
      const proj = configResult.config.project?.project
      if (org && proj) {
        logger.info(`  ${pc.green('✓')} Project: ${pc.dim(`${org}/${proj}`)}`)
      } else {
        logger.info(`  ${pc.yellow('○')} Project org/project not configured in supercheck.config.ts`)
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
          const ok = await installPlaywrightBrowsers(cwd)
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
      deps = checkAllDependencies(cwd, { requirePlaywright, requireK6 })
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
