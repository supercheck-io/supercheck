import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputMutation } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { pagerDutyConfig, routingKeyFromEnv } from '../utils/pagerduty.js'
import { readValueFromStdin } from '../utils/stdin.js'
import { withSpinner } from '../utils/spinner.js'

type PayloadOptions = { config?: string; payload?: string; data?: string }

function parsePayload(options: PayloadOptions, required = false): Record<string, unknown> | undefined {
  const values = [options.config, options.payload, options.data].filter((value): value is string => value !== undefined)
  if (values.length > 1) {
    throw new CLIError('Use only one of --payload, --data, or the legacy --config option', ExitCode.ConfigError)
  }
  if (values.length === 0) {
    if (required) throw new CLIError('Provider payload is required; use --payload <json>', ExitCode.ConfigError)
    return undefined
  }
  try {
    const parsed: unknown = JSON.parse(values[0])
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new CLIError('Provider payload must be a valid JSON object', ExitCode.ConfigError)
  }
}

/** The routing key comes from stdin or PAGERDUTY_ROUTING_KEY, never from an argument, so it stays out of shell history and process lists. */
async function readRoutingKey(fromStdin: boolean | undefined): Promise<string> {
  if (fromStdin && process.stdin.isTTY) {
    throw new CLIError('--routing-key-stdin reads a piped key, so it is not echoed on screen: use `< key.txt` or a pipe.', ExitCode.ConfigError)
  }
  const key = fromStdin ? (await readValueFromStdin()).trim() : routingKeyFromEnv()
  if (!key || key.startsWith('REPLACE_WITH_')) {
    throw new CLIError(
      'PagerDuty needs an Events API v2 routing key: set PAGERDUTY_ROUTING_KEY or pass --routing-key-stdin and pipe the key in.',
      ExitCode.ConfigError,
    )
  }
  return key
}

export const notificationCommand = new Command('notification')
  .alias('notifications')
  .description('Manage notification providers')

notificationCommand
  .command('list')
  .description('List notification providers')
  .action(async () => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching notification providers',
      () => client.get<Record<string, unknown>[]>('/api/notification-providers'),
    )

    output(data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type' },
        // A paging service (pagerduty, ...) is a webhook with a preset.
        { key: 'config', header: 'Preset', format: (value) => (value as { preset?: string } | undefined)?.preset ?? '-' },
        { key: 'isEnabled', header: 'Enabled' },
        { key: 'lastUsed', header: 'Last Used' },
        // ok | auth_failed (integration key rejected) | failing | unknown, from the last 7 days of deliveries.
        { key: 'health', header: 'Health', format: (value) => (value as { state?: string } | undefined)?.state ?? '-' },
      ],
    })
  })

notificationCommand
  .command('get <id>')
  .description('Get notification provider details')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching provider details',
      () => client.get<Record<string, unknown>>(`/api/notification-providers/${encodeURIComponent(id)}`),
    )
    outputDetail(data)
  })

notificationCommand
  .command('create')
  .description('Create a notification provider')
  .requiredOption('--type <type>', 'Provider type (email, slack, webhook, telegram, discord, teams, pagerduty)')
  .requiredOption('--name <name>', 'Provider name')
  .option('--payload <json>', 'Provider configuration as a JSON object')
  .option('--data <json>', 'Alias for --payload')
  .option('--config <json>', 'Legacy alias for --payload')
  .option('--routing-key-stdin', 'pagerduty: read the Events API v2 routing key from stdin (default: PAGERDUTY_ROUTING_KEY)')
  .action(async (options: { type: string; name: string; routingKeyStdin?: boolean } & PayloadOptions) => {
    const validTypes = ['email', 'slack', 'webhook', 'telegram', 'discord', 'teams', 'pagerduty']
    if (!validTypes.includes(options.type)) {
      throw new CLIError(
        `Invalid provider type. Must be one of: ${validTypes.join(', ')}`,
        ExitCode.ConfigError,
      )
    }

    let type = options.type
    let config = parsePayload(options) ?? {}
    if (options.type === 'pagerduty') {
      if (Object.keys(config).length > 0) {
        throw new CLIError('--type pagerduty takes its routing key from PAGERDUTY_ROUTING_KEY or --routing-key-stdin, not --payload', ExitCode.ConfigError)
      }
      // PagerDuty is a webhook with the pagerduty preset; the key goes in the body template, as in the web form.
      const routingKey = await readRoutingKey(options.routingKeyStdin)
      type = 'webhook'
      config = pagerDutyConfig(routingKey)
    } else if (options.routingKeyStdin) {
      throw new CLIError('--routing-key-stdin only applies to --type pagerduty', ExitCode.ConfigError)
    }

    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Creating notification provider',
      () => client.post<Record<string, unknown>>('/api/notification-providers', {
        name: options.name,
        type,
        config: { name: options.name, ...config },
      }),
    )

    logger.success(`Notification provider "${options.name}" created (${data.id})`)
    outputDetail(data)
  })

notificationCommand
  .command('update <id>')
  .description('Update a notification provider')
  .option('--name <name>', 'Provider name')
  .option('--type <type>', 'Provider type')
  .option('--payload <json>', 'Provider configuration as JSON (replaces the entire configuration)')
  .option('--data <json>', 'Alias for --payload')
  .option('--config <json>', 'Legacy alias for --payload')
  .option('--routing-key-stdin', 'pagerduty: read the Events API v2 routing key from stdin (default: PAGERDUTY_ROUTING_KEY)')
  .action(async (id: string, options: { name?: string; type?: string; routingKeyStdin?: boolean } & PayloadOptions) => {
    const client = createAuthenticatedClient()

    let suppliedConfig = parsePayload(options)
    let requestedType = options.type
    if (options.type === 'pagerduty') {
      if (suppliedConfig) throw new CLIError('--type pagerduty takes its routing key from PAGERDUTY_ROUTING_KEY or --routing-key-stdin, not --payload', ExitCode.ConfigError)
      // Same channel as create: a webhook with the pagerduty preset. Replaces the saved key, so this also rotates it.
      suppliedConfig = pagerDutyConfig(await readRoutingKey(options.routingKeyStdin))
      requestedType = 'webhook'
    } else if (options.routingKeyStdin) {
      throw new CLIError('--routing-key-stdin only applies to --type pagerduty', ExitCode.ConfigError)
    }
    if (!options.name && !requestedType && !suppliedConfig) {
      throw new CLIError('No fields to update. Use --name, --type, or --payload.', ExitCode.ConfigError)
    }

    // Fetch existing provider for name/type fallback
    // SECURITY: The GET response returns sanitized/masked config.
    // We must NOT merge user-provided config with the masked config,
    // as that would overwrite real credentials with masked placeholders.
    const { data: existing } = await withSpinner(
      'Fetching existing provider',
      () => client.get<Record<string, unknown>>(`/api/notification-providers/${encodeURIComponent(id)}`),
    )

    const maskedFields = (existing.maskedFields as string[] | undefined) ?? []

    const updatedName = options.name ?? String(existing.name ?? '')
    const updatedType = requestedType ?? String(existing.type ?? '')

    // Build config for the update
    let updatedConfig: Record<string, unknown> | undefined
    if (suppliedConfig) {
      // User provided explicit config — use it directly (don't merge with masked values)
      updatedConfig = suppliedConfig
    } else if (maskedFields.length > 0) {
      // No config provided AND existing config has masked fields.
      // Cannot safely send the masked config back — it would overwrite real credentials.
      // Only update name/type fields via a targeted request.
      logger.debug('Skipping config field (contains masked secrets that cannot be round-tripped safely)')
      updatedConfig = undefined
    } else {
      // Existing config has no masked fields — safe to send it back
      updatedConfig = (existing.config as Record<string, unknown>) ?? {}
    }

    // Ensure config.name stays in sync with top-level name
    if (updatedConfig) {
      updatedConfig.name = updatedName
    }

    const body: Record<string, unknown> = {
      name: updatedName,
      type: updatedType,
    }

    // Only include config if we have a safe value to send
    if (updatedConfig) {
      body.config = updatedConfig
    }

    const { data } = await withSpinner(
      'Updating notification provider',
      () => client.put<Record<string, unknown>>(`/api/notification-providers/${encodeURIComponent(id)}`, body),
    )
    logger.success(`Notification provider ${id} updated`)
    outputDetail(data)
  })

notificationCommand
  .command('delete <id>')
  .description('Delete a notification provider')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Delete notification provider ${id}?`, { default: false })
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting notification provider',
      () => client.delete(`/api/notification-providers/${encodeURIComponent(id)}`),
    )
    logger.success(`Notification provider ${id} deleted`)
    outputMutation({ id, deleted: true })
  })

notificationCommand
  .command('test [id]')
  .description('Send a test through a saved channel (by id), or test an unsaved configuration with --type and --payload')
  .option('--resolve', 'Saved webhook channels: resolve the test page instead of opening it')
  .option('--type <type>', 'Unsaved test: provider type (email, slack, webhook, telegram, discord, teams)')
  .option('--payload <json>', 'Unsaved test: provider configuration as a JSON object')
  .option('--data <json>', 'Alias for --payload')
  .option('--config <json>', 'Legacy alias for --payload')
  .action(async (id: string | undefined, options: { type?: string; resolve?: boolean } & PayloadOptions) => {
    const client = createAuthenticatedClient()
    if (id) {
      if (options.type || parsePayload(options)) {
        throw new CLIError('Pass either a channel id or --type with --payload, not both', ExitCode.ConfigError)
      }
      const action = options.resolve ? 'resolve' : 'trigger'
      const { data } = await withSpinner(
        options.resolve ? 'Resolving test page' : 'Sending test',
        () => client.post<Record<string, unknown>>(
          `/api/notification-providers/${encodeURIComponent(id)}/test`,
          { action },
          { retries: 0 },
        ),
      )
      outputDetail(data)
      if (data.ok !== true) {
        const status = typeof data.responseStatus === 'number' ? ` (HTTP ${data.responseStatus})` : ''
        throw new CLIError(String(data.error ?? `Test failed${status}`), ExitCode.GeneralError)
      }
      return
    }
    if (options.resolve) throw new CLIError('--resolve needs a saved channel id', ExitCode.ConfigError)
    if (!options.type) throw new CLIError('Pass a saved channel id, or --type with --payload for an unsaved configuration', ExitCode.ConfigError)
    const validTypes = ['email', 'slack', 'webhook', 'telegram', 'discord', 'teams']
    if (!validTypes.includes(options.type)) {
      throw new CLIError(
        `Invalid provider type. Must be one of: ${validTypes.join(', ')}`,
        ExitCode.ConfigError,
      )
    }

    const config = parsePayload(options, true)!

    const { data } = await withSpinner(
      'Sending test notification',
      () => client.post<{ success: boolean; message?: string; error?: string }>(
        '/api/notification-providers/test',
        { type: options.type, config },
      ),
    )

    if (data.success) {
      logger.success(data.message ?? 'Test notification sent successfully')
      if (getOutputFormat() !== 'table') outputDetail(data)
    } else {
      throw new CLIError(data.error ?? 'Test notification failed', ExitCode.GeneralError)
    }
  })
