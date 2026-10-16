import type { ApiClient } from '../api/client.js'
import { ApiRequestError, CLIError, ExitCode, TimeoutError } from './errors.js'

const terminalSuccess = ['passed', 'completed', 'success']
const terminalFailure = ['failed', 'error', 'blocked', 'cancelled', 'canceled', 'aborted']

// Timeouts, network failures, 429 and 5xx say nothing about the run itself; 4xx (auth, permission, not found) is final.
function isTransient(error: unknown): boolean {
  if (error instanceof TimeoutError) return true
  if (error instanceof ApiRequestError) return error.statusCode === undefined || error.statusCode === 429 || error.statusCode >= 500
  return false
}

// The poll after the final sleep starts at the deadline; a ~1ms budget would always abort, so it gets a bounded floor.
const FINAL_POLL_MS = 5_000
const pollTimeout = (remaining: number): number => remaining >= 1_000 ? Math.min(30_000, remaining) : FINAL_POLL_MS

export async function waitForRun(client: ApiClient, runId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  const timeout = (cause?: unknown) => new CLIError(`Run ${runId} did not complete before the wait deadline${cause instanceof Error ? ` (last poll error: ${cause.message})` : ''}. Use run wait ${runId} to resume observation.`, ExitCode.Timeout, { runId })
  let lastError: unknown
  for (;;) {
    try {
      const { data } = await client.request<Record<string, unknown>>('GET', `/api/runs/${runId}`, { timeout: pollTimeout(deadline - Date.now()), retries: 0 })
      lastError = undefined
      const status = String(data.status ?? '').toLowerCase()
      if (terminalSuccess.includes(status)) return data
      if (terminalFailure.includes(status)) throw new CLIError(`Run ${runId} ended with status ${status}.`, ExitCode.GeneralError, { runId, status })
    } catch (error) {
      if (!isTransient(error)) throw error
      lastError = error
    }
    // The poll above is the final one once the deadline has passed, so a run finishing at the last moment is still observed.
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw timeout(lastError)
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, remaining)))
  }
}
