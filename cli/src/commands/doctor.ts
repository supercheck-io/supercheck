import { Command } from 'commander'
import { logger } from '../utils/logger.js'
import { checkAllDependencies, formatDependencyReport, installPlaywrightBrowsers } from '../utils/deps.js'
import { getOutputFormat } from '../output/formatter.js'
import { discoverRepository } from '../utils/discover.js'
import { readConfigBaseUrl, readConfigIdentity } from '../utils/link-config.js'
import { detectConfigRequirements } from '../utils/config-text.js'
import { readSmallFile } from '../utils/safe-read.js'
import { resolve } from 'node:path'
import { getStoredBaseUrl, getToken, isAuthenticated } from '../auth/store.js'
import { getApiClient } from '../api/client.js'
import { ApiRequestError } from '../utils/errors.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import pc from '../utils/colors.js'

export const doctorCommand = new Command('doctor')
  .description('Check that all dependencies and configuration are set up correctly')
  .option('--fix', 'Attempt to automatically fix missing dependencies')
  .option('--strict', 'Exit non-zero unless dependencies, config and verified credentials are all in place')
  .action(async (options: { fix?: boolean; strict?: boolean }) => {
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
    const required = configText === null ? null : detectConfigRequirements(configText)
    const requirePlaywright = required?.playwright ?? false
    const requireK6 = required?.k6 ?? false
    const browser = required?.browser ?? 'chromium'
    if (required?.dynamic) logger.info(`  Note: some values in supercheck.config.ts are computed, so doctor reads only the literal ones (browser: ${browser}).`)

    // 1. Check dependencies
    logger.info(pc.bold('Dependencies:'))
    let deps = checkAllDependencies(cwd, { requirePlaywright, requireK6, browser })

    if (format === 'table') logger.info(formatDependencyReport(deps))

    logger.newline()

    // 2. Check authentication
    logger.info(pc.bold('Authentication:'))
    const hasCredentials = isAuthenticated()
    const storedBaseUrl = getStoredBaseUrl()
    const baseUrl = storedBaseUrl ?? 'https://app.supercheck.io'
    // The config is repository text, so doctor never sends a credential to the URL it names. A config that
    // targets another API than the one in use is reported instead of producing a misleading "rejected".
    const declaredBaseUrl = configResult ? readConfigBaseUrl(configResult.text) : null
    const originOf = (url: string): string => { try { return new URL(url).origin } catch { return url } }
    // The generated config reads `process.env.SUPERCHECK_URL ?? '<url>'`, so with the variable set it already agrees.
    const configTargetsOtherApi = declaredBaseUrl !== null && !process.env.SUPERCHECK_URL && originOf(declaredBaseUrl) !== originOf(baseUrl)
    const plainUrl = (url: string): string => (/^https?:\/\/[A-Za-z0-9.:_-]{1,253}(\/[A-Za-z0-9._~/-]{0,200})?$/.test(url) ? url : '(unprintable URL)')
    // Having a token is not the same as the server accepting it: ask the server before reporting success.
    let hasAuth = false
    let credentialProblem: 'rejected' | 'unreachable' | null = null
    if (hasCredentials && configTargetsOtherApi && storedBaseUrl === null) {
      credentialProblem = 'unreachable'
      logger.info(`  ${pc.yellow('○')} Credentials present, but supercheck.config.ts targets ${pc.dim(plainUrl(declaredBaseUrl))} and no API URL is set — set SUPERCHECK_URL (or run: supercheck login --url ...) to verify them there`)
    } else if (hasCredentials) {
      try {
        await getApiClient({ token: getToken() ?? undefined, baseUrl }).request('GET', '/api/context', { retries: 0, timeout: 5_000 })
        hasAuth = true
        logger.info(`  ${pc.green('✓')} Authenticated and verified (${pc.dim(baseUrl)})`)
      } catch (err) {
        if (err instanceof ApiRequestError && err.statusCode === 403) {
          // The server knows this credential; the role just cannot read the context.
          hasAuth = true
          logger.info(`  ${pc.green('✓')} Authenticated (${pc.dim(baseUrl)}), but this credential lacks permission to read its context`)
        } else if (err instanceof ApiRequestError && err.statusCode === 401) {
          credentialProblem = 'rejected'
          logger.info(`  ${pc.red('✗')} Credentials rejected by ${pc.dim(baseUrl)} — run: supercheck login --reauth`)
        } else {
          credentialProblem = 'unreachable'
          logger.info(`  ${pc.yellow('○')} Credentials present but ${pc.dim(baseUrl)} could not be reached to verify them`)
        }
      }
    } else {
      logger.info(`  ${pc.yellow('○')} Not authenticated — run: supercheck login`)
    }
    if (hasCredentials && configTargetsOtherApi && storedBaseUrl !== null) {
      logger.info(`  ${pc.yellow('○')} supercheck.config.ts targets ${pc.dim(plainUrl(declaredBaseUrl))}, not ${pc.dim(baseUrl)} — commands that use the config will refuse to run until they match`)
    }

    logger.newline()

    // 3. Configuration summary
    logger.info(pc.bold('Configuration:'))
    if (configResult) {
      logger.info(`  ${pc.green('✓')} supercheck.config.ts found (read as text, not executed)`)
      // Values come from repository text: show them only if they are plain identifiers (no terminal escapes).
      const plain = (v: string | null) => (v !== null && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null)
      const org = plain(configResult.identity.organization)
      const proj = plain(configResult.identity.project)
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
      // Unlike the rest of doctor, installing runs the project's own `npx playwright` from this directory.
      logger.warn('--fix runs `npx playwright install` in this directory, which uses the repository\'s own node_modules. Only use --fix in a repository you trust.')
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
        issues.push(credentialProblem === 'rejected' ? 'credentials rejected' : credentialProblem === 'unreachable' ? 'credentials unverified' : 'not authenticated')
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
      authenticationVerified: hasAuth,
      localReady: missingRequired.length === 0,
      cloudCredentialsPresent: hasCredentials,
      apiUrl: baseUrl,
      configFound: Boolean(configResult),
      ready: missingRequired.length === 0 && hasAuth && Boolean(configResult),
    }, null, 2))

    if (options.strict && !(missingRequired.length === 0 && hasAuth && configResult)) {
      const strictCode = missingRequired.length > 0 || !configResult ? ExitCode.ConfigError
        : credentialProblem === 'rejected' || !hasCredentials ? ExitCode.AuthError
        : credentialProblem === 'unreachable' ? ExitCode.ApiError
        : ExitCode.ConfigError
      throw new CLIError('Doctor found issues (--strict).', strictCode)
    }

    // Exit with error code if required deps are missing
    if (missingRequired.length > 0) {
      throw new CLIError(
        `Missing ${missingRequired.length} required dependency(s). Run 'supercheck doctor --fix' or install manually.`,
        ExitCode.ConfigError,
      )
    }
  })
