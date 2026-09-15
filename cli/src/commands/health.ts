import { Command } from 'commander'
import { getApiClient } from '../api/client.js'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { getStoredBaseUrl } from '../auth/store.js'
import { tryLoadConfig } from '../config/loader.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output } from '../output/formatter.js'
import { CLIError, ApiRequestError, ExitCode } from '../utils/errors.js'
import { withSpinner } from '../utils/spinner.js'

export const healthCommand = new Command('health')
  .description('Check Supercheck API health')
  .option('--url <url>', 'Supercheck API URL')
  .action(async (options: { url?: string }) => {
    const configResult = await tryLoadConfig()
    const baseUrl = options.url
      ?? getStoredBaseUrl()
      ?? configResult?.config.api?.baseUrl
      ?? 'https://app.supercheck.io'

    const client = getApiClient({ baseUrl })

    try {
      const data = await withSpinner(
        `Checking API health at ${baseUrl}...`,
        async () => {
          const { data } = await client.get<{
            status: string
            timestamp?: string
            latencyMs?: number
            checks?: Record<string, { status: string; latencyMs?: number; error?: string }>
          }>('/api/health')
          return data
        },
        { successText: 'Health check complete' },
      )

      // Build a flat view for display
      const checks = data.checks ?? {}
      const displayData: Record<string, unknown> = {
        status: data.status,
        database: checks.database?.status ?? 'n/a',
        redis: checks.redis?.status ?? 'n/a',
        s3: checks.s3?.status ?? 'n/a',
        latencyMs: data.latencyMs,
      }

      output(displayData as Record<string, unknown>, {
        columns: [
          { key: 'status', header: 'Status' },
          { key: 'database', header: 'Database' },
          { key: 'redis', header: 'Redis' },
          { key: 's3', header: 'S3' },
          { key: 'latencyMs', header: 'Latency (ms)' },
        ],
      })

      if (data.status === 'ok') {
        if (getOutputFormat() !== 'json') {
          logger.success(`API is healthy at ${baseUrl}`)
        }
      } else {
        throw new CLIError(`API reports degraded status at ${baseUrl}`, ExitCode.ApiError)
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode) {
        logger.error(`API error from ${baseUrl}: HTTP ${err.statusCode}`)
        throw err
      }
      if (err instanceof CLIError) throw err
      const msg = err instanceof Error ? err.message : String(err)
      logger.error(`Cannot reach API at ${baseUrl}: ${msg}`)
      throw new CLIError(`Cannot reach API at ${baseUrl}: ${msg}`, ExitCode.ApiError)
    }
  })

export const locationsCommand = new Command('locations')
  .description('List available execution locations')
  .action(async () => {
    const client = createAuthenticatedClient()

    const locations = await withSpinner(
      'Fetching execution locations...',
      async () => {
        const { data } = await client.get<
          | { locations: Array<{ id?: string; code?: string; name: string; region: string }> }
          | { success: boolean; data: Array<{ code: string; name: string; region: string }> }
        >('/api/locations')

        return 'locations' in data
          ? data.locations
          : (data.data ?? [])
      },
      { successText: 'Locations loaded' },
    )

    output(locations as unknown as Record<string, unknown>[], {
      columns: [
        { key: 'code', header: 'Code' },
        { key: 'name', header: 'Name' },
        { key: 'region', header: 'Region' },
      ],
    })
  })
