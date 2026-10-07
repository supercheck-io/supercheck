import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import type { PaginatedResponse } from '../api/client.js'
import { withSpinner } from '../utils/spinner.js'
import { getSse } from '../utils/sse.js'

export const runCommand = new Command('run')
  .description('Manage runs')

runCommand
  .command('list')
  .description('List runs')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '50')
  .option('--job <jobId>', 'Filter by job ID')
  .option('--status <status>', 'Filter by status')
  .action(async (options: { page: string; limit: string; status?: string; job?: string }) => {
    const client = createAuthenticatedClient()

    const params: Record<string, string> = {
      page: options.page,
      limit: options.limit,
    }
    if (options.job) params.jobId = options.job
    if (options.status) params.status = options.status

    const { data } = await withSpinner(
      'Fetching runs',
      () => client.get<PaginatedResponse<Record<string, unknown>>>(
        '/api/runs',
        params,
      ),
    )

    output(data.data, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'jobName', header: 'Job' },
        { key: 'status', header: 'Status' },
        { key: 'trigger', header: 'Trigger' },
        { key: 'startedAt', header: 'Started' },
      ],
    })

    outputPagination(data.pagination)
  })

runCommand
  .command('get <id>')
  .description('Get run details')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching run details',
      () => client.get<Record<string, unknown>>(`/api/runs/${id}`),
    )
    outputDetail(data)
  })

runCommand
  .command('status <id>')
  .description('Get run status')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching run status',
      () => client.get<Record<string, unknown>>(`/api/runs/${id}/status`),
    )
    outputDetail(data)
  })

runCommand
  .command('permissions <id>')
  .description('Get run access permissions')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching run permissions',
      () => client.get<Record<string, unknown>>(`/api/runs/${id}/permissions`),
    )
    const payload = (data as { data?: Record<string, unknown> }).data ?? data
    outputDetail(payload)
  })

runCommand
  .command('stream <id>')
  .description('Stream live console output from a run')
  .option('--idle-timeout <seconds>', 'Abort if no data received within this period', '60')
  .action(async (id: string, options: { idleTimeout: string }) => {
    const json = getOutputFormat() === 'json'
    await getSse(`/api/runs/${id}/stream`, ({ event, data }) => {
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (json) logger.output(JSON.stringify({ event, data }))
      else if (getOutputFormat() === 'table' && event === 'console' && typeof record.line === 'string') process.stdout.write(record.line)
      else if (event === 'status') logger.info(`Status: ${String(record.status ?? 'unknown')}`)
      if (event === 'complete') {
        if (['failed', 'error', 'cancelled', 'canceled', 'blocked', 'not_found'].includes(String(record.status))) {
          throw new CLIError(`Run ended with status: ${String(record.status)}`, ExitCode.GeneralError)
        }
        if (!json) logger.success(`Run complete: ${String(record.status ?? 'done')}`)
        return false
      }
    }, Math.max(Number(options.idleTimeout) || 60, 10) * 1000)
  })

runCommand
  .command('cancel <id>')
  .description('Cancel a running execution')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Cancelling run',
      () => client.post<Record<string, unknown>>(`/api/runs/${id}/cancel`),
    )
    outputDetail(data)
  })
