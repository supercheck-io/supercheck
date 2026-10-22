import { waitForRun } from '../utils/wait.js'
import { parseIntStrict } from '../utils/number.js'
import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import type { PaginatedResponse } from '../api/client.js'
import { withSpinner } from '../utils/spinner.js'
import { getSse } from '../utils/sse.js'

/**
 * The API stores the report's storage location (an internal host such as http://rustfs:9000/...).
 * Show the address that works from outside: the application's own report route.
 */
export function publicReportUrl(client: { getBaseUrl(): string }, run: Record<string, unknown>): Record<string, unknown> {
  if (typeof run.reportUrl !== 'string' || !run.reportUrl || typeof run.id !== 'string') return run
  return { ...run, reportUrl: `${client.getBaseUrl().replace(/\/$/, '')}/api/test-results/${encodeURIComponent(run.id)}/report/index.html` }
}

export const runCommand = new Command('run')
  .description('Manage runs')

runCommand
  .command('list')
  .description('List job runs (runs of a test executed directly are not listed; use `test execute --wait` or `run get <runId>`)')
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

    output(data.data.map((run) => publicReportUrl(client, run)), {
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
    outputDetail(publicReportUrl(client, data))
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
    }, { idleTimeoutMs: Math.max(Number(options.idleTimeout) || 60, 10) * 1000, isTerminal: ({ event }) => event === 'complete' })
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

runCommand.command('wait <id>')
  .description('Wait for a run with a bounded deadline; does not trigger a new run')
  .option('--timeout <seconds>', 'Maximum wait time', '300')
  .action(async (id: string, options: { timeout: string }) => {
    const timeout = parseIntStrict(options.timeout, '--timeout', { min: 1 }) * 1000
    outputDetail(await waitForRun(createAuthenticatedClient(), id, timeout))
  })
