import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputPagination } from '../output/formatter.js'
import type { PaginatedResponse } from '../api/client.js'
import { parseBooleanStrict, parseIntStrict } from '../utils/number.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode } from '../utils/errors.js'

const VALID_MONITOR_TYPES = ['http_request', 'website', 'ping_host', 'port_check', 'synthetic_test'] as const
const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const

function normalizeMonitorType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!VALID_MONITOR_TYPES.includes(normalized as typeof VALID_MONITOR_TYPES[number])) {
    throw new CLIError(
      `Invalid value for --type: "${value}". Expected one of: ${VALID_MONITOR_TYPES.join(', ')}.`,
      ExitCode.ConfigError,
    )
  }
  return normalized
}

function normalizeHttpMethod(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!VALID_HTTP_METHODS.includes(normalized as typeof VALID_HTTP_METHODS[number])) {
    throw new CLIError(
      `Invalid value for --method: "${value}". Expected one of: ${VALID_HTTP_METHODS.join(', ')}.`,
      ExitCode.ConfigError,
    )
  }
  return normalized
}

function getLatestMonitorResponseTimeMs(data: Record<string, unknown>): number | undefined {
  const recentResults = data.recentResults
  if (!Array.isArray(recentResults) || recentResults.length === 0) return undefined

  const latest = recentResults[0]
  if (!latest || typeof latest !== 'object') return undefined

  const responseTimeMs = (latest as Record<string, unknown>).responseTimeMs
  return typeof responseTimeMs === 'number' ? responseTimeMs : undefined
}

export const monitorCommand = new Command('monitor')
  .description('Manage monitors')

monitorCommand
  .command('list')
  .description('List all monitors')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '50')
  .action(async (options: { page: string; limit: string }) => {
    const client = createAuthenticatedClient()

    const { data } = await withSpinner(
      'Fetching monitors',
      () => client.get<PaginatedResponse<Record<string, unknown>>>(
        '/api/monitors',
        { page: options.page, limit: options.limit },
      ),
    )

    output(data.data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type' },
        { key: 'status', header: 'Status' },
        { key: 'frequencyMinutes', header: 'Freq (min)' },
      ],
    })

    outputPagination(data.pagination)
  })

monitorCommand
  .command('get <id>')
  .description('Get monitor details')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor details',
      () => client.get<Record<string, unknown>>(`/api/monitors/${id}`),
    )
    outputDetail(data)
  })

monitorCommand
  .command('results <id>')
  .description('Get monitor check results')
  .option('--limit <limit>', 'Number of results', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async (id: string, options: { limit: string; page: string }) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor results',
      () => client.get<{ data: Record<string, unknown>[]; pagination?: { page: number; totalPages: number; total: number } }>(
        `/api/monitors/${id}/results`,
        { limit: options.limit, page: options.page },
      ),
    )

    output(data.data, {
      columns: [
        { key: 'checkedAt', header: 'Time' },
        { key: 'status', header: 'Status' },
        { key: 'responseTimeMs', header: 'Response (ms)' },
        { key: 'location', header: 'Location' },
      ],
    })

    outputPagination(data.pagination)
  })

monitorCommand
  .command('stats <id>')
  .description('Get monitor performance statistics')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor statistics',
      () => client.get<Record<string, unknown>>(`/api/monitors/${id}/stats`),
    )

    if (getOutputFormat() === 'json') {
      outputDetail(data)
      return
    }

    // The API returns { success, data: { period24h, period30d }, meta }
    const statsData = (data.data ?? data) as Record<string, unknown>
    const period24h = statsData.period24h as Record<string, unknown> | undefined
    const period30d = statsData.period30d as Record<string, unknown> | undefined

    if (period24h) {
      logger.header('Last 24 Hours')
      outputDetail(period24h)
      logger.info('')
    }

    if (period30d) {
      logger.header('Last 30 Days')
      outputDetail(period30d)
      logger.info('')
    }

    // Show meta information if available
    const meta = data.meta as Record<string, unknown> | undefined
    if (meta) {
      logger.header('Meta')
      outputDetail(meta)
    }
  })

monitorCommand
  .command('status <id>')
  .description('Get current monitor status')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor status',
      () => client.get<Record<string, unknown>>(`/api/monitors/${id}`),
    )
    const statusInfo: Record<string, unknown> = {
      id: data.id,
      name: data.name,
      status: data.status,
      lastCheckAt: data.lastCheckAt,
      responseTimeMs: getLatestMonitorResponseTimeMs(data),
    }
    outputDetail(statusInfo)
  })

monitorCommand
  .command('create')
  .description('Create a new monitor')
  .requiredOption('--name <name>', 'Monitor name')
  .requiredOption('--url <url>', 'URL to monitor')
  .option('--type <type>', 'Monitor type (http_request, website, ping_host, port_check, synthetic_test)', 'http_request')
  .option('--interval-minutes <minutes>', 'Check interval in minutes (1-1440)', '5')
  .option('--interval <seconds>', '[deprecated: use --interval-minutes] Check interval in seconds')
  .option('--timeout <seconds>', 'Request timeout in seconds', '30')
  .option('--method <method>', 'HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)', 'GET')
  .option('--dry-run', 'Show what would be sent without creating')
  .action(async (options: { name: string; url: string; type: string; intervalMinutes: string; interval?: string; timeout: string; method: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()
    const monitorType = normalizeMonitorType(options.type)
    const method = normalizeHttpMethod(options.method)

    let frequencyMinutes: number
    if (options.interval !== undefined) {
      logger.warn('--interval (seconds) is deprecated. Use --interval-minutes instead.')
      const intervalSeconds = parseIntStrict(options.interval, '--interval', { min: 60 })
      if (intervalSeconds % 60 !== 0) {
        throw new CLIError(
          `--interval must be a multiple of 60 seconds. Got ${intervalSeconds}s. Use --interval-minutes for direct minute values.`,
          ExitCode.ConfigError,
        )
      }
      frequencyMinutes = intervalSeconds / 60
    } else {
      frequencyMinutes = parseIntStrict(options.intervalMinutes, '--interval-minutes', { min: 1, max: 1440 })
    }

    const body: Record<string, unknown> = {
      name: options.name,
      target: options.url,
      type: monitorType,
      frequencyMinutes,
      config: {
        timeoutSeconds: parseIntStrict(options.timeout, '--timeout', { min: 1 }),
        method,
      },
    }

    if (options.dryRun) {
      logger.header('Dry run — monitor create payload:')
      logger.info(JSON.stringify(body, null, 2))
      return
    }

    const { data } = await withSpinner(
      'Creating monitor',
      () => client.post<Record<string, unknown>>('/api/monitors', body),
    )
    logger.success(`Monitor "${options.name}" created (${data.id})`)
    outputDetail(data)
  })

monitorCommand
  .command('update <id>')
  .description('Update a monitor')
  .option('--name <name>', 'Monitor name')
  .option('--url <url>', 'URL to monitor')
  .option('--interval-minutes <minutes>', 'Check interval in minutes (1-1440)')
  .option('--interval <seconds>', '[deprecated: use --interval-minutes] Check interval in seconds')
  .option('--timeout <seconds>', 'Request timeout in seconds')
  .option('--method <method>', 'HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)')
  .option('--active <boolean>', 'Enable or disable monitor (true/false)')
  .option('--dry-run', 'Show what would be sent without updating')
  .action(async (id: string, options: { name?: string; url?: string; intervalMinutes?: string; interval?: string; timeout?: string; method?: string; active?: string; dryRun?: boolean }) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = {}
    if (options.name !== undefined) body.name = options.name
    if (options.url !== undefined) body.target = options.url
    if (options.interval !== undefined) {
      logger.warn('--interval (seconds) is deprecated. Use --interval-minutes instead.')
      const intervalSeconds = parseIntStrict(options.interval, '--interval', { min: 60 })
      if (intervalSeconds % 60 !== 0) {
        throw new CLIError(
          `--interval must be a multiple of 60 seconds. Got ${intervalSeconds}s. Use --interval-minutes for direct minute values.`,
          ExitCode.ConfigError,
        )
      }
      body.frequencyMinutes = intervalSeconds / 60
    } else if (options.intervalMinutes !== undefined) {
      body.frequencyMinutes = parseIntStrict(options.intervalMinutes, '--interval-minutes', { min: 1, max: 1440 })
    }
    if (options.active !== undefined) body.enabled = parseBooleanStrict(options.active, '--active')

    // timeout and method go in config object
    const config: Record<string, unknown> = {}
    if (options.timeout !== undefined) config.timeoutSeconds = parseIntStrict(options.timeout, '--timeout', { min: 1 })
    if (options.method !== undefined) config.method = normalizeHttpMethod(options.method)
    if (Object.keys(config).length > 0) body.config = config

    if (Object.keys(body).length === 0) {
      logger.warn('No fields to update. Use --name, --url, --interval-minutes, --timeout, --method, or --active.')
      return
    }

    if (options.dryRun) {
      logger.header('Dry run — monitor update payload:')
      logger.info(JSON.stringify(body, null, 2))
      return
    }

    const { data } = await withSpinner(
      'Updating monitor',
      () => client.patch<Record<string, unknown>>(`/api/monitors/${id}`, body),
    )
    logger.success(`Monitor ${id} updated`)
    outputDetail(data)
  })

monitorCommand
  .command('delete <id>')
  .description('Delete a monitor')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      const confirmed = await confirmPrompt(`Delete monitor ${id}?`, { default: false })
      if (!confirmed) {
        logger.info('Aborted')
        return
      }
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting monitor',
      () => client.delete(`/api/monitors/${id}`),
    )
    logger.success(`Monitor ${id} deleted`)
  })
