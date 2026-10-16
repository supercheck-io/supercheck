import type { ApiClient } from '../api/client.js'
import { CLIError, ExitCode, TimeoutError } from './errors.js'

export async function waitForRun(client: ApiClient, runId: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  const timeout = () => new CLIError(`Run ${runId} did not complete before the wait deadline. Use run wait ${runId} to resume observation.`, ExitCode.Timeout, { runId })
  while (Date.now() < deadline) {
    const { data } = await client.request<Record<string, unknown>>('GET', `/api/runs/${runId}`, { timeout: Math.max(1, Math.min(30_000, deadline - Date.now())), retries: 0 }).catch((error: unknown) => {
      if (error instanceof TimeoutError && Date.now() >= deadline) throw timeout()
      throw error
    })
    const status = String(data.status ?? '').toLowerCase()
    if (['passed', 'completed', 'success'].includes(status)) return data
    if (['failed', 'error', 'blocked', 'cancelled', 'canceled', 'aborted'].includes(status)) throw new CLIError(`Run ${runId} ended with status ${status}.`, ExitCode.GeneralError, { runId, status })
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000, Math.max(0, deadline - Date.now()))))
  }
  throw timeout()
}
