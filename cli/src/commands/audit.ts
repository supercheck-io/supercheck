import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { output, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { withSpinner } from '../utils/spinner.js'

interface AuditResponse {
  success: boolean
  data: {
    logs: Array<{
      id: string
      action: string
      details: unknown
      createdAt: string
      user: { id: string; name: string | null; email: string | null }
    }>
    pagination: {
      currentPage: number
      totalPages: number
      totalCount: number
      limit: number
      hasNext: boolean
      hasPrev: boolean
    }
  }
}

export const auditCommand = new Command('audit')
  .description('View audit logs (admin)')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '20')
  .option('--search <query>', 'Search by action')
  .option('--action <action>', 'Filter by action type')
  .action(async (options: { page: string; limit: string; search?: string; action?: string }) => {
    const client = createAuthenticatedClient()

    const params: Record<string, string> = {
      page: options.page,
      limit: options.limit,
    }
    if (options.search) params.search = options.search
    if (options.action) params.action = options.action

    const { data } = await withSpinner(
      'Fetching audit logs',
      () => client.get<AuditResponse>('/api/audit', params),
    )

    if (!data.success) {
      throw new CLIError('Failed to fetch audit logs', ExitCode.ApiError)
    }

    const rows = data.data.logs.map((log) => ({
      id: log.id,
      action: log.action,
      user: log.user?.email ?? log.user?.name ?? '-',
      createdAt: log.createdAt,
    }))

    output(rows, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'action', header: 'Action' },
        { key: 'user', header: 'User' },
        { key: 'createdAt', header: 'Date' },
      ],
    })

    outputPagination(data.data.pagination)
  })
