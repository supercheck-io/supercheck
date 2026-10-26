import { agentCommand } from '../commands/agent.js'
import { discoverCommand } from '../commands/discover.js'
import { onboardCommand } from '../commands/onboard.js'
import { planCommand } from '../commands/plan.js'
import { linkCommand } from '../commands/link.js'
import { ciCommand } from '../commands/ci.js'
import { classifyError } from '../utils/error-codes.js'
import { verifyContext } from '../utils/managed.js'
import { parseIntStrict } from '../utils/number.js'
import { isUuid } from '../utils/paths.js'
import { getToken, getStoredBaseUrl, isAuthenticated } from '../auth/store.js'
import { skillsCommand, schemaCommand, capabilitiesCommand } from '../commands/skills.js'
import { redact, redactText, setRevealSecrets } from '../utils/redact.js'
import { Command } from 'commander'
import pc from '../utils/colors.js'
import { loginCommand, logoutCommand, whoamiCommand } from '../commands/login.js'
import { healthCommand, locationsCommand } from '../commands/health.js'
import { configCommand } from '../commands/config.js'
import { initCommand } from '../commands/init.js'
import { jobCommand } from '../commands/jobs.js'
import { runCommand, dashboardCommand } from '../commands/runs.js'
import { testCommand } from '../commands/tests.js'
import { monitorCommand } from '../commands/monitors.js'
import { varCommand } from '../commands/variables.js'
import { tagCommand } from '../commands/tags.js'
import { requirementCommand } from '../commands/requirements.js'
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
import { analyticsCommand } from '../commands/analytics.js'
import { tokenCommand } from '../commands/tokens.js'
import { projectCommand } from '../commands/projects.js'
import { setOutputFormat, setWideOutput, setJsonEnvelope, flushJsonList, type OutputFormat } from '../output/formatter.js'
import { logger, getOutputCount, setMachineMode, setQuietMode, setLogLevel } from '../utils/logger.js'
import { ApiRequestError, CLIError, ExitCode } from '../utils/errors.js'
import { DependencyError } from '../utils/deps.js'
import { CLI_VERSION } from '../version.js'
import { createAuthenticatedClient, getResolvedDeclaredBaseUrl, getResolvedProject, resolveAndSetConfigBaseUrl } from '../api/authenticated-client.js'

const program = new Command()
  .name('supercheck')
  .description('Open-source testing, monitoring, and AI SRE — as code')
  .version(CLI_VERSION, '-v, --version')
  .option('--json', 'Output in JSON format')
  .option('--quiet', 'Suppress non-essential output')
  .option('--debug', 'Enable debug logging')
  .option('--no-color', 'Disable ANSI colors')
  .option('--show-secrets', 'Explicitly include sensitive configuration in output')
  .option('--envelope', 'Include pagination metadata in JSON lists (requires --json)')
  .option('--wide', 'Show tables without width limits')
  .hook('preAction', async (_thisCommand, actionCommand) => {
    const opts = program.opts()
    setMachineMode(Boolean(opts.json))
    setJsonEnvelope(Boolean(opts.json && opts.envelope))
    setRevealSecrets(Boolean(opts.showSecrets))
    setWideOutput(Boolean(opts.wide))

    if (opts.json) {
      setOutputFormat('json' as OutputFormat)
      setQuietMode(true)
      setLogLevel('silent')
    }

    if (opts.quiet && !opts.json) {
      setQuietMode(true)
      setOutputFormat('quiet' as OutputFormat)
    }

    if (opts.debug && !opts.json) {
      setLogLevel('debug')
    }
    if (opts.envelope && !opts.json) throw new CLIError('--envelope requires --json.', ExitCode.ConfigError)

    if (['skills', 'schema'].includes(actionCommand.name()) || ['skills', 'schema'].includes(actionCommand.parent?.name() ?? '')) return

    const actionOpts = typeof actionCommand.opts === 'function'
      ? actionCommand.opts<Record<string, unknown>>()
      : {}
    for (const key of ['page', 'limit'] as const) {
      if (typeof actionOpts[key] === 'string') {
        const max = key === 'limit' ? (['test', 'run'].includes(actionCommand.parent?.name() ?? '') ? 1000 : 100) : undefined
        parseIntStrict(actionOpts[key], `--${key}`, { min: 1, max })
      }
    }
    let topLevel: Command = actionCommand
    while (topLevel.parent && topLevel.parent !== program) topLevel = topLevel.parent
    for (const [index, argument] of actionCommand.registeredArguments.entries()) {
      if (['job', 'test', 'monitor', 'run', 'tag', 'notification', 'notifications', 'service'].includes(topLevel.name()) && /^(id|jobId|keyId|runId|testId)$/.test(argument.name()) && !isUuid(actionCommand.args[index]?.toLowerCase())) {
        throw new CLIError(`${argument.name()} must be a valid UUID.`, ExitCode.ConfigError)
      }
    }

    const isNotificationCommand =
      actionCommand.name() === 'notification' ||
      actionCommand.name() === 'notifications' ||
      actionCommand.parent?.name() === 'notification' ||
      actionCommand.parent?.name() === 'notifications'

    // Commands that inspect an untrusted checkout must never load its .env or execute its config.
    // Identify them by their top-level command, not by a (possibly coincidental) subcommand name.
    if (['discover', 'onboard', 'plan', 'ci', 'agent', 'link'].includes(topLevel.name())) return

    if (actionOpts.offline || ['init', 'login', 'logout', 'doctor'].includes(actionCommand.name()) || (actionCommand.name() === 'capabilities' && !actionOpts.online)) return

    const diagnostic = ['whoami', 'health', 'locations', 'capabilities'].includes(actionCommand.name()) && (actionCommand.parent?.name() ?? '') === program.name()
    if (diagnostic && (getStoredBaseUrl() || actionOpts.url)) return

    const configPath =
      !isNotificationCommand &&
      typeof actionOpts.config === 'string'
        ? actionOpts.config
        : undefined
    try { await resolveAndSetConfigBaseUrl({ configPath }) } catch (error) {
      if (!diagnostic) throw error
      logger.warn('Ignoring invalid project configuration for diagnostics. Set SUPERCHECK_URL to select the API target explicitly.')
      return
    }
    // Script validation uses the configured server and .env, but has no project resources to resolve.
    if (topLevel.name() === 'test' && actionCommand.name() === 'validate') return
    if (diagnostic) return
    const project = getResolvedProject()
    const group = actionCommand.parent?.name()
    const sync = ['deploy', 'diff', 'destroy', 'pull'].includes(actionCommand.name())
    if (project && getToken() && !sync && !['config', 'supercheck'].includes(group ?? '')) {
      const client = createAuthenticatedClient()
      await verifyContext(client, { project }, true, getResolvedDeclaredBaseUrl())
    }
  })

program.hook('postAction', (_command, action) => {
  flushJsonList()
  if (program.opts().json && getOutputCount() === 0) logger.output(JSON.stringify({ status: 'success', command: action.name() }))
})

// Register commands — auth
program.addCommand(skillsCommand)
program.addCommand(schemaCommand)
program.addCommand(capabilitiesCommand)
program.addCommand(agentCommand)
program.addCommand(discoverCommand)
program.addCommand(onboardCommand)
program.addCommand(planCommand)
program.addCommand(linkCommand)
program.addCommand(ciCommand)
program.addCommand(loginCommand)
program.addCommand(logoutCommand)
program.addCommand(whoamiCommand)

// Register commands — project
program.addCommand(initCommand)
program.addCommand(configCommand)

// Register commands — resources
program.addCommand(jobCommand)
program.addCommand(runCommand)
program.addCommand(dashboardCommand)
program.addCommand(testCommand)
program.addCommand(monitorCommand)
program.addCommand(varCommand)
program.addCommand(tagCommand)
program.addCommand(requirementCommand)

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
program.addCommand(analyticsCommand)
program.addCommand(tokenCommand)
program.addCommand(projectCommand)

// Register commands — utilities
program.addCommand(healthCommand)
program.addCommand(locationsCommand)
program.addCommand(doctorCommand)
program.addCommand(upgradeCommand)

// Global error handler
function configureErrors(command: Command): void {
  command.exitOverride()
  command.configureOutput({ outputError: (message, write) => { if (!process.argv.includes('--json')) write(message) } })
  for (const child of command.commands) configureErrors(child)
}
configureErrors(program)

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    const code = err instanceof DependencyError ? ExitCode.ConfigError
      : err instanceof CLIError ? err.exitCode
      : err && typeof err === 'object' && 'exitCode' in err && typeof err.exitCode === 'number'
        ? err.exitCode : ExitCode.GeneralError
    // Help output is not an error: print nothing more (commander already showed the usage).
    const commanderCode = err && typeof err === 'object' && 'code' in err && typeof err.code === 'string' ? err.code : ''
    if (['commander.help', 'commander.helpDisplayed', 'commander.version'].includes(commanderCode)) process.exit(code)

    if ((program.opts().json || process.argv.includes('--json')) && code !== 0) {
      const classified = classifyError(err, isAuthenticated())
      console.error(JSON.stringify(redact({
        error: err instanceof Error ? err.message : String(err),
        exitCode: code,
        ...(err instanceof ApiRequestError ? { status: err.statusCode, details: err.responseBody } : {}),
        ...(err instanceof CLIError && err.details !== undefined ? { details: err.details } : {}),
        code: err instanceof Error && /^[A-Z_]+:/.test(err.message) ? err.message.split(':')[0] : classified?.code,
        ...(classified ? { retryable: classified.retryable, nextActions: classified.nextActions } : {}),
      })))
      process.exit(code)
    }

    if (err instanceof ApiRequestError && err.responseBody !== undefined) {
      const details = (() => {
        if (typeof err.responseBody === 'string') {
          return err.responseBody.trim() ? `Details: ${err.responseBody}` : ''
        }
        if (err.responseBody && typeof err.responseBody === 'object') {
          return `Details: ${JSON.stringify(redact(err.responseBody), null, 2)}`
        }
        return err.responseBody ? `Details: ${String(err.responseBody)}` : ''
      })()

      const suffix = details ? `\n${details}\n` : '\n'
      console.error(pc.red(redactText(`\n✗ ${err.message}${suffix}`)))
      process.exit(err.exitCode)
    }

    if (err instanceof DependencyError) {
      console.error(pc.red(redactText(`\n✗ Missing dependency: ${err.dependency}`)))
      console.error(pc.yellow(redactText(`\n${err.message}\n`)))
      console.error(pc.dim('Run `supercheck doctor` for a full dependency check.\n'))
      process.exit(ExitCode.ConfigError)
    }

    if (err instanceof CLIError) {
      if (err.exitCode !== ExitCode.Success) {
        console.error(pc.red(redactText(`\n✗ ${err.message}\n`)))
      }
      process.exit(err.exitCode)
    }

    // Commander.js exit override throws CommanderError for --help, --version, etc.
    // Check for exitCode property (Commander sets exitCode: 0 for successful exits)
    if (err && typeof err === 'object' && 'exitCode' in err && typeof err.exitCode === 'number') {
      process.exit(err.exitCode)
    }

    // Unknown error
    console.error(pc.red(redactText(`\n✗ Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`)))
    process.exit(ExitCode.GeneralError)
  }
}

main()
