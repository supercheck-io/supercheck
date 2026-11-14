import { Command } from 'commander'
import { CLIError, ExitCode } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { outputMutation } from '../output/formatter.js'
import { getProxyAgent, getProxyEnv } from '../utils/proxy.js'
import { CLI_VERSION } from '../version.js'

const PING_PATH = /^\/api\/heartbeat\/hb_[0-9a-f]{32}$/
const PING_TIMEOUT_MS = 10_000

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
  .description('Send one ping to a heartbeat monitor; exits 0 when the server accepts it')
  .option('--start', 'Report that the job started (measures run duration)')
  .option('--fail', 'Report that the job failed (the monitor goes down at once)')
  .action(async (raw: string, options: { start?: boolean; fail?: boolean }) => {
    if (options.start && options.fail) throw new CLIError('Use either --start or --fail, not both.', ExitCode.ConfigError)
    const action = options.start ? 'start' : options.fail ? 'fail' : undefined
    const url = buildPingRequestUrl(raw, action)
    const kind = /\/(start|fail)$/.exec(url.pathname)?.[1] ?? 'ping'
    const proxy = getProxyEnv(url)
    let status: number
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': `supercheck-cli/${CLI_VERSION}` },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
        ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
      } as RequestInit)
      status = response.status
      await response.body?.cancel()
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new CLIError(`Ping to ${url.origin} timed out after ${PING_TIMEOUT_MS / 1000}s.`, ExitCode.Timeout)
      throw new CLIError(`Ping to ${url.origin} failed: could not connect.`, ExitCode.GeneralError)
    }
    if (status < 200 || status >= 300) {
      throw new CLIError(`Ping to ${url.origin} was rejected with HTTP ${status}${status === 429 ? ' (rate limited: 10 pings per minute per URL, 120 per minute per client IP)' : ''}.`, ExitCode.ApiError)
    }
    logger.success(`Ping sent${kind === 'ping' ? '' : ` (${kind})`}`)
    outputMutation({ sent: true, kind, httpStatus: status })
  })
