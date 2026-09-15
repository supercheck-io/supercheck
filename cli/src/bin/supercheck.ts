import { Command } from 'commander'
import pc from 'picocolors'
import { loginCommand, logoutCommand, whoamiCommand } from '../commands/login.js'
import { healthCommand, locationsCommand } from '../commands/health.js'
import { configCommand } from '../commands/config.js'
import { initCommand } from '../commands/init.js'
import { jobCommand } from '../commands/jobs.js'
import { runCommand } from '../commands/runs.js'
import { testCommand } from '../commands/tests.js'
import { monitorCommand } from '../commands/monitors.js'
import { varCommand } from '../commands/variables.js'
import { tagCommand } from '../commands/tags.js'
import { diffCommand } from '../commands/diff.js'
import { deployCommand } from '../commands/deploy.js'
import { destroyCommand } from '../commands/destroy.js'
import { pullCommand } from '../commands/pull.js'
import { validateCommand } from '../commands/validate.js'
import { notificationCommand } from '../commands/notifications.js'
import { alertCommand } from '../commands/alerts.js'
import { auditCommand } from '../commands/audit.js'
import { doctorCommand } from '../commands/doctor.js'
import { upgradeCommand } from '../commands/upgrade.js'
import { incidentCommand } from '../commands/incidents.js'
import { serviceCommand } from '../commands/services.js'
import { sreCommand } from '../commands/sre.js'
import { setOutputFormat, type OutputFormat } from '../output/formatter.js'
import { setQuietMode, setLogLevel } from '../utils/logger.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
import { DependencyError } from '../utils/deps.js'
import { CLI_VERSION } from '../version.js'
import { resolveAndSetConfigBaseUrl } from '../api/authenticated-client.js'

const program = new Command()
  .name('supercheck')
  .description('Open-source testing, monitoring, and AI SRE — as code')
  .version(CLI_VERSION, '-v, --version')
  .option('--json', 'Output in JSON format')
  .option('--quiet', 'Suppress non-essential output')
  .option('--debug', 'Enable debug logging')
  .hook('preAction', async (_thisCommand, actionCommand) => {
    const opts = program.opts()

    if (opts.json) {
      setOutputFormat('json' as OutputFormat)
    }

    if (opts.quiet) {
      setQuietMode(true)
      setOutputFormat('quiet' as OutputFormat)
    }

    if (opts.debug) {
      setLogLevel('debug')
    }

    const actionOpts = typeof actionCommand.opts === 'function'
      ? actionCommand.opts<Record<string, unknown>>()
      : {}

    const isNotificationCommand =
      actionCommand.name() === 'notification' ||
      actionCommand.name() === 'notifications' ||
      actionCommand.parent?.name() === 'notification' ||
      actionCommand.parent?.name() === 'notifications'

    const configPath =
      !isNotificationCommand &&
      typeof actionOpts.config === 'string'
        ? actionOpts.config
        : undefined
    await resolveAndSetConfigBaseUrl({ configPath })
  })

// Register commands — auth
program.addCommand(loginCommand)
program.addCommand(logoutCommand)
program.addCommand(whoamiCommand)

// Register commands — project
program.addCommand(initCommand)
program.addCommand(configCommand)

// Register commands — resources
program.addCommand(jobCommand)
program.addCommand(runCommand)
program.addCommand(testCommand)
program.addCommand(monitorCommand)
program.addCommand(varCommand)
program.addCommand(tagCommand)

// Register commands — monitoring-as-code
program.addCommand(diffCommand)
program.addCommand(deployCommand)
program.addCommand(validateCommand)
program.addCommand(destroyCommand)
program.addCommand(pullCommand)

// Register commands — notifications & alerts
program.addCommand(notificationCommand)
program.addCommand(alertCommand)
program.addCommand(auditCommand)

// Register commands — AI SRE
program.addCommand(incidentCommand)
program.addCommand(serviceCommand)
program.addCommand(sreCommand)

// Register commands — utilities
program.addCommand(healthCommand)
program.addCommand(locationsCommand)
program.addCommand(doctorCommand)
program.addCommand(upgradeCommand)

// Global error handler
program.exitOverride()

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof ApiRequestError && err.responseBody !== undefined) {
      const details = (() => {
        if (typeof err.responseBody === 'string') {
          return err.responseBody.trim() ? `Details: ${err.responseBody}` : ''
        }
        if (err.responseBody && typeof err.responseBody === 'object') {
          return `Details: ${JSON.stringify(err.responseBody, null, 2)}`
        }
        return err.responseBody ? `Details: ${String(err.responseBody)}` : ''
      })()

      const suffix = details ? `\n${details}\n` : '\n'
      console.error(pc.red(`\n✗ ${err.message}${suffix}`))
      process.exit(err.exitCode)
    }

    if (err instanceof DependencyError) {
      console.error(pc.red(`\n✗ Missing dependency: ${err.dependency}`))
      console.error(pc.yellow(`\n${err.message}\n`))
      console.error(pc.dim('Run `supercheck doctor` for a full dependency check.\n'))
      process.exit(ExitCode.ConfigError)
    }

    if (err instanceof CLIError) {
      if (err.exitCode !== ExitCode.Success) {
        console.error(pc.red(`\n✗ ${err.message}\n`))
      }
      process.exit(err.exitCode)
    }

    // Commander.js exit override throws CommanderError for --help, --version, etc.
    // Check for exitCode property (Commander sets exitCode: 0 for successful exits)
    if (err && typeof err === 'object' && 'exitCode' in err && typeof err.exitCode === 'number') {
      process.exit(err.exitCode)
    }

    // Unknown error
    console.error(pc.red(`\n✗ Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`))
    process.exit(ExitCode.GeneralError)
  }
}

main()
