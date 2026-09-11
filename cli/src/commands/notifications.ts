import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { withSpinner } from '../utils/spinner.js'

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
        { key: 'enabled', header: 'Enabled' },
        { key: 'lastUsed', header: 'Last Used' },
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
      () => client.get<Record<string, unknown>>(`/api/notification-providers/${id}`),
    )
    outputDetail(data)
  })

notificationCommand
  .command('create')
  .description('Create a notification provider')
  .requiredOption('--type <type>', 'Provider type (email, slack, webhook, telegram, discord, teams)')
  .requiredOption('--name <name>', 'Provider name')
  .option('--config <json>', 'Provider config as JSON string')
  .action(async (options: { type: string; name: string; config?: string }) => {
    const validTypes = ['email', 'slack', 'webhook', 'telegram', 'discord', 'teams']
    if (!validTypes.includes(options.type)) {
      throw new CLIError(
        `Invalid provider type. Must be one of: ${validTypes.join(', ')}`,
        ExitCode.ConfigError,
      )
    }

    let config: Record<string, unknown> = {}
    if (options.config) {
      try {
        config = JSON.parse(options.config)
      } catch {
        throw new CLIError('Invalid JSON in --config', ExitCode.ConfigError)
      }
    }

    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Creating notification provider',
      () => client.post<Record<string, unknown>>('/api/notification-providers', {
        name: options.name,
        type: options.type,
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
  .option('--config <json>', 'Provider config as JSON string (replaces entire config — include all fields)')
  .action(async (id: string, options: { name?: string; type?: string; config?: string }) => {
    const client = createAuthenticatedClient()

    if (!options.name && !options.type && !options.config) {
      logger.warn('No fields to update. Use --name, --type, or --config.')
      return
    }

    // Fetch existing provider for name/type fallback
    // SECURITY: The GET response returns sanitized/masked config.
    // We must NOT merge user-provided config with the masked config,
    // as that would overwrite real credentials with masked placeholders.
    const { data: existing } = await withSpinner(
      'Fetching existing provider',
      () => client.get<Record<string, unknown>>(`/api/notification-providers/${id}`),
    )

    const maskedFields = (existing.maskedFields as string[] | undefined) ?? []

    const updatedName = options.name ?? String(existing.name ?? '')
    const updatedType = options.type ?? String(existing.type ?? '')

    // Build config for the update
    let updatedConfig: Record<string, unknown>
    if (options.config) {
      // User provided explicit config — use it directly (don't merge with masked values)
      try {
        updatedConfig = JSON.parse(options.config)
      } catch {
        throw new CLIError('Invalid JSON in --config', ExitCode.GeneralError)
      }
    } else if (maskedFields.length > 0) {
      // No config provided AND existing config has masked fields.
      // Cannot safely send the masked config back — it would overwrite real credentials.
      // Only update name/type fields via a targeted request.
      logger.debug('Skipping config field (contains masked secrets that cannot be round-tripped safely)')
      updatedConfig = undefined as unknown as Record<string, unknown>
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
      () => client.put<Record<string, unknown>>(`/api/notification-providers/${id}`, body),
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
      const confirmed = await confirmPrompt(`Delete notification provider ${id}?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting notification provider',
      () => client.delete(`/api/notification-providers/${id}`),
    )
    logger.success(`Notification provider ${id} deleted`)
  })

notificationCommand
  .command('test')
  .description('Send a test notification to verify provider configuration')
  .requiredOption('--type <type>', 'Provider type (email, slack, webhook, telegram, discord, teams)')
  .requiredOption('--config <json>', 'Provider config as JSON string')
  .action(async (options: { type: string; config: string }) => {
    const validTypes = ['email', 'slack', 'webhook', 'telegram', 'discord', 'teams']
    if (!validTypes.includes(options.type)) {
      throw new CLIError(
        `Invalid provider type. Must be one of: ${validTypes.join(', ')}`,
        ExitCode.ConfigError,
      )
    }

    let config: Record<string, unknown> = {}
    try {
      config = JSON.parse(options.config)
    } catch {
      throw new CLIError('Invalid JSON in --config', ExitCode.ConfigError)
    }

    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Sending test notification',
      () => client.post<{ success: boolean; message?: string; error?: string }>(
        '/api/notification-providers/test',
        { type: options.type, config },
      ),
    )

    if (data.success) {
      logger.success(data.message ?? 'Test notification sent successfully')
    } else {
      throw new CLIError(data.error ?? 'Test notification failed', ExitCode.GeneralError)
    }
  })
