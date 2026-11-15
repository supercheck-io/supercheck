import { Command } from 'commander'
import { CLIError, ExitCode } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { outputMutation } from '../output/formatter.js'
import { getProxyAgent, getProxyEnv } from '../utils/proxy.js'
import { CLI_VERSION } from '../version.js'

// Any prefix, so an app served under a sub-path (https://example.com/supercheck/api/heartbeat/...) works.
const PING_PATH = /^(?:\/[^/]+)*\/api\/heartbeat\/hb_[0-9a-f]{32}$/
const PING_TIMEOUT_MS = 10_000
const MAX_RETRIES = 3
const MAX_RETRY_AFTER_MS = 30_000
const TOTAL_BUDGET_MS = 60_000
const RETRY_STATUSES = new Set([429, 503])

/** Swappable in tests. */
export const pingTiming = {
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

/** Retry-After in seconds or as an HTTP date, capped; otherwise 1 s, 2 s, 4 s. */
export function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const backoff = 1000 * 2 ** attempt
  if (!retryAfter) return backoff
  const seconds = Number(retryAfter)
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - pingTiming.now()
  return Number.isFinite(ms) ? Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS) : backoff
}

/** Validate a heartbeat ping URL and add the optional /start or /fail suffix. Errors never repeat the URL (it holds the token). */
export function buildPingRequestUrl(raw: string, action?: 'start' | 'fail'): URL {
  let url: URL
  try { url = new URL(raw.trim()) } catch { url = new URL('invalid:') }
  const trimmed = url.pathname.replace(/\/+$/, '')
  const suffix = /\/(start|fail)$/.exec(trimmed)?.[1] as 'start' | 'fail' | undefined
  const path = suffix ? trimmed.slice(0, -suffix.length - 1) : trimmed
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !PING_PATH.test(path)) {
    throw new CLIError('Invalid ping URL. Expected https://<your-app>/api/heartbeat/hb_<32 hex characters>, as shown when the monitor was created.', ExitCode.ConfigError)
  }
  // A pasted /start or /fail URL keeps its meaning; a flag that contradicts it is an error, never a silent success ping.
  if (suffix && action && suffix !== action) throw new CLIError(`The URL already ends in /${suffix}; drop it or the --${action} flag.`, ExitCode.ConfigError)
  const kind = action ?? suffix
  url.pathname = kind ? `${path}/${kind}` : path
  url.search = ''
  url.hash = ''
  return url
}

export const heartbeatCommand = new Command('heartbeat')
  .description('Send heartbeat pings from cron jobs and scheduled tasks (no login needed)')

heartbeatCommand
  .command('ping <url>')
  .description('Send one ping to a heartbeat monitor (retries 429, 503 and network errors); exits 0 when the server accepts it')
  .option('--start', 'Report that the job started (measures run duration)')
  .option('--fail', 'Report that the job failed (the monitor goes down at once)')
  .action(async (raw: string, options: { start?: boolean; fail?: boolean }) => {
    if (options.start && options.fail) throw new CLIError('Use either --start or --fail, not both.', ExitCode.ConfigError)
    const action = options.start ? 'start' : options.fail ? 'fail' : undefined
    const url = buildPingRequestUrl(raw, action)
    const kind = /\/(start|fail)$/.exec(url.pathname)?.[1] ?? 'ping'
    const proxy = getProxyEnv(url)
    const started = pingTiming.now()
    // Retries only 429, 503 and network errors or timeouts (a repeated ping is harmless), within about 60 s in total.
    let status = 0
    let failure: CLIError | undefined
    for (let attempt = 0; ; attempt++) {
      let retryAfter: string | null = null
      failure = undefined
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': `supercheck-cli/${CLI_VERSION}` },
          signal: AbortSignal.timeout(PING_TIMEOUT_MS),
          ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
        } as RequestInit)
        status = response.status
        retryAfter = response.headers.get('retry-after')
        await response.body?.cancel()
      } catch (error) {
        failure = error instanceof Error && error.name === 'TimeoutError'
          ? new CLIError(`Ping to ${url.origin} timed out after ${PING_TIMEOUT_MS / 1000}s.`, ExitCode.Timeout)
          : new CLIError(`Ping to ${url.origin} failed: could not connect.`, ExitCode.GeneralError)
      }
      const retryable = failure !== undefined || RETRY_STATUSES.has(status)
      if (!retryable || attempt >= MAX_RETRIES) break
      const delay = retryDelayMs(retryAfter, attempt)
      if (pingTiming.now() - started + delay + PING_TIMEOUT_MS > TOTAL_BUDGET_MS) break
      logger.debug(`Ping attempt ${attempt + 1} ${failure ? 'failed' : `got HTTP ${status}`}; retrying in ${delay} ms`)
      await pingTiming.sleep(delay)
    }
    if (failure) throw failure
    if (status < 200 || status >= 300) {
      throw new CLIError(`Ping to ${url.origin} was rejected with HTTP ${status}${status === 429 ? ' (rate limited: 10 pings per minute per URL, 1200 per minute per client IP)' : ''}.`, ExitCode.ApiError)
    }
    logger.success(`Ping sent${kind === 'ping' ? '' : ` (${kind})`}`)
    outputMutation({ sent: true, kind, httpStatus: status })
  })
