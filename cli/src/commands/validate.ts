import { Command } from 'commander'
import pc from 'picocolors'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { loadConfig } from '../config/loader.js'
import { buildLocalResources } from '../utils/resources.js'
import { normalizeTestTypeForApi, validateScripts, validateScriptTypeMatch } from '../utils/validation.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { withSpinner } from '../utils/spinner.js'

export const validateCommand = new Command('validate')
  .description('Validate local test scripts against Supercheck rules')
  .option('--config <path>', 'Path to config file')
  .action(async (options: { config?: string }) => {
    const cwd = process.cwd()
    const { config } = await loadConfig({ cwd, configPath: options.config })
    const client = createAuthenticatedClient()

    const localResources = buildLocalResources(config, cwd)
    const tests = localResources.filter((r) => r.type === 'test')

    if (tests.length === 0) {
      logger.warn('No local tests found to validate.')
      return
    }

    // Pre-flight: fast client-side script-type mismatch detection
    let preflightFailed = false
    for (const test of tests) {
      const script = String(test.definition?.script ?? '')
      const declaredType = normalizeTestTypeForApi(test.definition?.testType)
      const mismatch = validateScriptTypeMatch(script, declaredType)
      if (mismatch) {
        logger.error(`${pc.red('✗')} ${test.name}: ${mismatch}`)
        preflightFailed = true
      }
    }
    if (preflightFailed) {
      throw new CLIError('Script-type mismatch detected. Fix the test type or script content before validating.', ExitCode.ConfigError)
    }

    const inputs = tests.map((test) => ({
      name: test.name,
      script: String(test.definition?.script ?? ''),
      testType: normalizeTestTypeForApi(test.definition?.testType),
    }))

    const results = await withSpinner('Validating test scripts...', async () => {
      return validateScripts(client, inputs)
    }, { successText: 'Validation complete' })

    logger.newline()
    logger.header('Validation Results')
    logger.newline()

    let failed = 0
    for (const result of results) {
      if (result.valid) {
        logger.info(pc.green(`  ✓ ${result.name}`))
        if (result.warnings && result.warnings.length > 0) {
          logger.info(pc.yellow(`    Warnings: ${result.warnings.join(', ')}`))
        }
      } else {
        failed++
        logger.info(pc.red(`  ✗ ${result.name}`))
        logger.info(pc.gray(`    ${result.error ?? 'Validation failed'}`))
      }
    }

    logger.newline()

    if (failed > 0) {
      throw new CLIError(`Validation failed for ${failed} test(s).`, ExitCode.ConfigError)
    }

    logger.success('All tests passed validation.')
  })