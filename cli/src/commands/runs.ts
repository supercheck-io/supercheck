import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { logger } from '../utils/logger.js'
import { output, outputDetail, outputPagination } from '../output/formatter.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import type { PaginatedResponse } from '../api/client.js'
import { CLI_VERSION } from '../version.js'
import { withSpinner } from '../utils/spinner.js'
import { getProxyAgent, getProxyEnv } from '../utils/proxy.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'

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
    const token = requireAuth()
    const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
    const idleTimeoutMs = Math.max(Number(options.idleTimeout) || 60, 10) * 1000

    const url = `${baseUrl}/api/runs/${id}/stream`
    const parsedUrl = new URL(url)

    logger.info(`Streaming output for run ${id}...`)
    logger.newline()

    const controller = new AbortController()
    const connectTimeout = setTimeout(() => controller.abort(), 30_000)

    try {
      const proxy = getProxyEnv(parsedUrl)
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
          'User-Agent': `supercheck-cli/${CLI_VERSION}`,
        },
        ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
        signal: controller.signal,
      })

      clearTimeout(connectTimeout)

      if (!response.ok) {
        throw new CLIError(`Failed to connect to stream: ${response.status}`, ExitCode.ApiError)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new CLIError('No response body for SSE stream', ExitCode.ApiError)
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = ''

      // Idle timeout: abort if no data received within the configured period
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
      }
      resetIdleTimer()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        resetIdleTimer()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          // SSE comment (keepalive) — ignore
          if (line.startsWith(':')) continue

          // SSE event type
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
            continue
          }

          // SSE retry directive — ignore
          if (line.startsWith('retry:')) continue

          // SSE data payload
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)

              switch (currentEvent) {
                case 'console':
                  // Server sends { line: "..." } for console output
                  if (parsed.line !== undefined) {
                    process.stdout.write(parsed.line + '\n')
                  }
                  break
                case 'status':
                  logger.info(`Status: ${parsed.status ?? JSON.stringify(parsed)}`)
                  break
                case 'complete':
                  logger.success(`Run complete: ${parsed.status ?? 'done'}`)
                  if (idleTimer) clearTimeout(idleTimer)
                  return
                case 'error':
                  logger.error(`Stream error: ${parsed.message ?? JSON.stringify(parsed)}`)
                  break
                case 'heartbeat':
                  // Server keepalive — no action needed
                  break
                default:
                  // Unknown or unnamed event — show status/output if present
                  if (parsed.output) {
                    process.stdout.write(parsed.output)
                  } else if (parsed.status) {
                    logger.info(`Status: ${parsed.status}`)
                  }
                  break
              }
            } catch {
              // Raw text output
              process.stdout.write(data)
            }
            // Reset event type after processing data
            currentEvent = ''
            continue
          }

          // Empty line marks end of SSE event block — reset event type
          if (line.trim() === '') {
            currentEvent = ''
          }
        }
      }

      if (idleTimer) clearTimeout(idleTimer)
    } catch (err) {
      if (err instanceof CLIError) throw err
      if (err instanceof Error && err.name === 'AbortError') {
        throw new CLIError(
          `Stream timed out (no data received for ${Math.round(idleTimeoutMs / 1000)}s)`,
          ExitCode.Timeout,
        )
      }
      throw new CLIError(
        `Stream error: ${err instanceof Error ? err.message : String(err)}`,
        ExitCode.ApiError,
      )
    }
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
