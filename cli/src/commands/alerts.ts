import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output, outputPagination } from '../output/formatter.js'
import type { PaginatedResponse } from '../api/client.js'
import { withSpinner } from '../utils/spinner.js'

export const alertCommand = new Command('alert')
  .alias('alerts')
  .description('View alert history')

alertCommand
  .command('history')
  .description('Get alert history')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Number of results per page', '50')
  .action(async (options: { page: string; limit: string }) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching alert history',
      () => client.get<
        PaginatedResponse<Record<string, unknown>> | Record<string, unknown>[]
      >('/api/alerts/history', { page: options.page, limit: options.limit }),
    )

    // Handle both flat array and paginated response
    const items = Array.isArray(data) ? data : data.data
    const pagination = Array.isArray(data) ? null : data.pagination

    output(items, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'targetType', header: 'Target Type' },
        { key: 'targetName', header: 'Target' },
        { key: 'type', header: 'Alert Type' },
        { key: 'status', header: 'Status' },
        { key: 'timestamp', header: 'Time' },
      ],
    })

    outputPagination(pagination)
  })
