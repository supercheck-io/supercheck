import { Command } from 'commander'
import { createAuthenticatedClient } from '../api/authenticated-client.js'
import { logger } from '../utils/logger.js'
import { getOutputFormat, output, outputDetail, outputMutation, outputPagination } from '../output/formatter.js'
import type { PaginatedResponse } from '../api/client.js'
import { parseBooleanStrict, parseIntStrict } from '../utils/number.js'
import { withSpinner } from '../utils/spinner.js'
import { CLIError, ExitCode } from '../utils/errors.js'
import { z } from 'zod'

const HEARTBEAT_MAX_INTERVAL_MINUTES = 44640
const HEARTBEAT_MAX_GRACE_MINUTES = 1440

const VALID_MONITOR_TYPES = ['http_request', 'website', 'ping_host', 'port_check', 'synthetic_test', 'heartbeat', 'mcp_server'] as const
const DURATION_UNITS: Record<string, number> = { m: 1, h: 60, d: 1440 }

/** `5m`, `1h`, `1d` (or bare minutes) to whole minutes, within the server's limits. */
export function parseDurationMinutes(value: string, flag: string, max: number): number {
  const match = /^(\d+)\s*([mhd])?$/i.exec(value.trim())
  const minutes = match ? Number(match[1]) * DURATION_UNITS[(match[2] ?? 'm').toLowerCase()] : NaN
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > max) {
    throw new CLIError(`Invalid value for ${flag}: "${value}". Use a duration such as 5m, 1h or 1d, between 1 minute and ${max} minutes.`, ExitCode.ConfigError)
  }
  return minutes
}

/** Heartbeat ping URLs are secrets: shown only when the server returns one (create, reveal, rotate). */
export function outputWithPingUrl(data: Record<string, unknown>, pingUrl: unknown): void {
  if (typeof pingUrl !== 'string' || !pingUrl) { outputDetail(data); return }
  if (getOutputFormat() !== 'table') { outputDetail(data); return }
  const heartbeat = data.heartbeat && typeof data.heartbeat === 'object' ? { ...(data.heartbeat as Record<string, unknown>) } : undefined
  if (heartbeat) delete heartbeat.pingUrl
  const rest: Record<string, unknown> = { ...data, ...(heartbeat ? { heartbeat } : {}) }
  delete rest.pingUrl
  if (Object.keys(rest).length > 0) outputDetail(rest)
  logger.output(`\nPing URL (keep it secret; it is shown only now):\n${pingUrl}`, { redact: false })
}

/** Table view of a heartbeat row: its own state (late included), interval with grace, and last ping. */
function heartbeatRow(row: Record<string, unknown>): Record<string, unknown> {
  const heartbeat = row.heartbeat as Record<string, unknown> | undefined
  if (row.type !== 'heartbeat' || !heartbeat) return row
  return { ...row, status: heartbeat.state ?? row.status, frequencyMinutes: `${row.frequencyMinutes} (grace ${heartbeat.graceMinutes ?? '-'})`, lastPingAt: heartbeat.lastPingAt }
}
const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const

function normalizeMonitorType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!VALID_MONITOR_TYPES.includes(normalized as typeof VALID_MONITOR_TYPES[number])) {
    throw new CLIError(
      `Invalid value for --type: "${value}". Expected one of: ${VALID_MONITOR_TYPES.join(', ')}.`,
      ExitCode.ConfigError,
    )
  }
  return normalized
}

function normalizeHttpMethod(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!VALID_HTTP_METHODS.includes(normalized as typeof VALID_HTTP_METHODS[number])) {
    throw new CLIError(
      `Invalid value for --method: "${value}". Expected one of: ${VALID_HTTP_METHODS.join(', ')}.`,
      ExitCode.ConfigError,
    )
  }
  return normalized
}

function validateMonitorTarget(target: string, type?: string): void {
  if (type === 'mcp_server') {
    try {
      const url = new URL(target)
      // http is allowed through: the server accepts it only on self-hosted installs with internal targets on.
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('url')
    } catch { throw new CLIError('--url must be an http(s) URL with no credentials or fragment for mcp_server.', ExitCode.ConfigError) }
    return
  }
  if (!type || ['http_request', 'website'].includes(type)) {
    try {
      if (!['http:', 'https:'].includes(new URL(target).protocol)) throw new Error('protocol')
    } catch { throw new CLIError('--url must be a valid HTTP(S) URL.', ExitCode.ConfigError) }
  }
}

function getLatestMonitorResponseTimeMs(data: Record<string, unknown>): number | undefined {
  const recentResults = data.recentResults
  if (!Array.isArray(recentResults) || recentResults.length === 0) return undefined

  const latest = recentResults[0]
  if (!latest || typeof latest !== 'object') return undefined

  const responseTimeMs = (latest as Record<string, unknown>).responseTimeMs
  return typeof responseTimeMs === 'number' ? responseTimeMs : undefined
}

export const monitorCommand = new Command('monitor')
  .description('Manage monitors')

monitorCommand
  .command('list')
  .description('List all monitors')
  .option('--page <page>', 'Page number', '1')
  .option('--limit <limit>', 'Items per page', '50')
  .action(async (options: { page: string; limit: string }) => {
    const client = createAuthenticatedClient()

    const { data } = await withSpinner(
      'Fetching monitors',
      () => client.get<PaginatedResponse<Record<string, unknown>>>(
        '/api/monitors',
        { page: options.page, limit: options.limit },
      ),
    )

    const rows = getOutputFormat() === 'table' ? data.data.map(heartbeatRow) : data.data
    output(rows, {
      columns: [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'Name' },
        { key: 'type', header: 'Type' },
        { key: 'status', header: 'Status' },
        { key: 'frequencyMinutes', header: 'Freq (min)' },
        ...(rows.some((row) => row.type === 'heartbeat') ? [{ key: 'lastPingAt', header: 'Last ping' }] : []),
      ],
    })

    outputPagination(data.pagination)
  })

monitorCommand
  .command('get <id>')
  .description('Get monitor details')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor details',
      () => client.get<Record<string, unknown>>(`/api/monitors/${encodeURIComponent(id)}`),
    )
    if (getOutputFormat() === 'table') {
      const detail = { ...data }
      delete detail.scheduledJobId
      outputDetail(detail)
    } else outputDetail(data)
  })

monitorCommand
  .command('results <id>')
  .description('Get monitor check results')
  .option('--limit <limit>', 'Number of results', '20')
  .option('--page <page>', 'Page number', '1')
  .action(async (id: string, options: { limit: string; page: string }) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor results',
      () => client.get<{ data: Record<string, unknown>[]; pagination?: { page: number; totalPages: number; total: number } }>(
        `/api/monitors/${encodeURIComponent(id)}/results`,
        { limit: options.limit, page: options.page },
      ),
    )

    output(data.data, {
      columns: [
        { key: 'checkedAt', header: 'Time' },
        { key: 'status', header: 'Status' },
        { key: 'responseTimeMs', header: 'Response (ms)' },
        { key: 'location', header: 'Location' },
      ],
    })

    outputPagination(data.pagination)
  })

monitorCommand
  .command('stats <id>')
  .description('Get monitor performance statistics')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor statistics',
      () => client.get<Record<string, unknown>>(`/api/monitors/${encodeURIComponent(id)}/stats`),
    )

    if (getOutputFormat() === 'json') {
      outputDetail(data)
      return
    }

    // The API returns { success, data: { period24h, period30d }, meta }
    const statsData = (data.data ?? data) as Record<string, unknown>
    const period24h = statsData.period24h as Record<string, unknown> | undefined
    const period30d = statsData.period30d as Record<string, unknown> | undefined

    if (period24h) {
      logger.header('Last 24 Hours')
      outputDetail(period24h)
      logger.info('')
    }

    if (period30d) {
      logger.header('Last 30 Days')
      outputDetail(period30d)
      logger.info('')
    }

    // Show meta information if available
    const meta = data.meta as Record<string, unknown> | undefined
    if (meta) {
      logger.header('Meta')
      outputDetail(meta)
    }
  })

monitorCommand
  .command('status <id>')
  .description('Get current monitor status')
  .action(async (id: string) => {
    const client = createAuthenticatedClient()
    const { data } = await withSpinner(
      'Fetching monitor status',
      () => client.get<Record<string, unknown>>(`/api/monitors/${encodeURIComponent(id)}`),
    )
    const statusInfo: Record<string, unknown> = {
      id: data.id,
      name: data.name,
      status: (data.heartbeat as Record<string, unknown> | undefined)?.state ?? data.status,
      lastCheckAt: data.lastCheckAt,
      responseTimeMs: getLatestMonitorResponseTimeMs(data),
    }
    outputDetail(statusInfo)
  })

const AI_PRESET_ONLY = ['model', 'secret', 'keyHeader', 'prompt', 'expect', 'maxTokens', 'firstTokenTimeout', 'warnFirstTokenMs', 'warnTokens'] as const
const flagName = (key: string) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`

/** `--preset ai-endpoint`: the request is built by the worker from these fields, so method/headers/body are not sent. */
export function buildAiEndpointPreset(options: { preset?: string; model?: string; secret?: string; keyHeader?: string; prompt?: string; expect?: string; maxTokens?: string; firstTokenTimeout?: string; warnFirstTokenMs?: string; warnTokens?: string; method?: string }, monitorType: string): Record<string, unknown> | undefined {
  if (options.preset === undefined) {
    const stray = AI_PRESET_ONLY.find((key) => options[key] !== undefined)
    if (stray) throw new CLIError(`${flagName(stray)} requires --preset ai-endpoint.`, ExitCode.ConfigError)
    return undefined
  }
  if (options.preset !== 'ai-endpoint') throw new CLIError(`Unknown preset: ${options.preset}. Use ai-endpoint.`, ExitCode.ConfigError)
  if (monitorType !== 'http_request') throw new CLIError('--preset ai-endpoint requires --type http_request.', ExitCode.ConfigError)
  if (!options.model?.trim()) throw new CLIError('--model is required with --preset ai-endpoint.', ExitCode.ConfigError)
  // The preset always sends POST; an explicit other method would be silently ignored.
  if (options.method !== undefined && options.method.toUpperCase() !== 'POST') throw new CLIError('--method cannot be used with --preset ai-endpoint (it always sends POST).', ExitCode.ConfigError)
  return {
    model: options.model.trim(),
    ...(options.secret ? { secretKey: options.secret } : {}),
    ...(options.keyHeader ? { keyHeader: options.keyHeader } : {}),
    ...(options.prompt ? { prompt: options.prompt } : {}),
    ...(options.expect ? { expectText: options.expect } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: parseIntStrict(options.maxTokens, '--max-tokens', { min: 1, max: 512 }) } : {}),
    ...(options.firstTokenTimeout !== undefined ? { firstTokenTimeoutMs: parseIntStrict(options.firstTokenTimeout, '--first-token-timeout', { min: 500, max: 60000 }) } : {}),
    ...(options.warnFirstTokenMs !== undefined ? { warnFirstTokenMs: parseIntStrict(options.warnFirstTokenMs, '--warn-first-token-ms', { min: 100, max: 60000 }) } : {}),
    ...(options.warnTokens !== undefined ? { warnTotalTokens: parseIntStrict(options.warnTokens, '--warn-tokens', { min: 1, max: 1000000 }) } : {}),
  }
}

const MCP_ONLY = ['header', 'requireTool', 'callTool', 'callArgs', 'slowMs'] as const
const collect = (value: string, previous: string[] = []) => [...previous, value]

interface McpOptions { secret?: string; header?: string; protocol?: string; requireTool?: string[]; callTool?: string; callArgs?: string; expect?: string; slowMs?: string }

/** `--type mcp_server`: login comes from a project secret (name only); `--header` switches bearer to a custom header. */
export function buildMcpConfig(options: McpOptions & { protocol?: string }, monitorType: string): Record<string, unknown> | undefined {
  if (monitorType !== 'mcp_server') {
    const stray = MCP_ONLY.find((key) => options[key] !== undefined)
    if (stray) throw new CLIError(`${flagName(stray)} requires --type mcp_server.`, ExitCode.ConfigError)
    return undefined
  }
  if (options.header !== undefined && !options.secret) throw new CLIError('--header requires --secret.', ExitCode.ConfigError)
  if (options.protocol !== undefined && !['auto', '2025', '2026'].includes(options.protocol)) throw new CLIError('--protocol must be auto, 2025 or 2026 for mcp_server.', ExitCode.ConfigError)
  if ((options.callArgs !== undefined || options.expect !== undefined) && !options.callTool) throw new CLIError('--call-args and --expect require --call-tool.', ExitCode.ConfigError)
  let args: Record<string, unknown> | undefined
  if (options.callArgs !== undefined) {
    try {
      const parsed: unknown = JSON.parse(options.callArgs)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object')
      args = parsed as Record<string, unknown>
    } catch { throw new CLIError('--call-args must be a JSON object.', ExitCode.ConfigError) }
  }
  const auth = !options.secret ? { type: 'none' }
    : options.header ? { type: 'header', secretKey: options.secret, headerName: options.header }
    : { type: 'bearer', secretKey: options.secret }
  return {
    auth,
    ...(options.protocol ? { protocol: options.protocol } : {}),
    ...(options.requireTool?.length ? { requiredTools: options.requireTool } : {}),
    ...(options.callTool ? { toolCall: { name: options.callTool, ...(args ? { arguments: args } : {}), ...(options.expect ? { expectText: options.expect } : {}) } } : {}),
    ...(options.slowMs !== undefined ? { slowMs: parseIntStrict(options.slowMs, '--slow-ms', { min: 100, max: 60000 }) } : {}),
  }
}

monitorCommand
  .command('create')
  .description('Create a new monitor')
  .requiredOption('--name <name>', 'Monitor name')
  .option('--url <url>', 'URL or hostname to monitor (required except for synthetic tests)')
  .option('--type <type>', 'Monitor type (http_request, website, ping_host, port_check, synthetic_test, heartbeat, mcp_server)', 'http_request')
  .option('--interval-minutes <minutes>', 'Check interval in minutes (1-1440)', '5')
  .option('--every <duration>', 'Heartbeat: expected ping interval, e.g. 5m, 1h, 1d (up to 31d)')
  .option('--grace <duration>', 'Heartbeat: how late a ping may be before the monitor goes down, e.g. 10m (up to 1d)')
  .option('--interval <seconds>', '[deprecated: use --interval-minutes] Check interval in seconds')
  .option('--timeout <seconds>', 'Request timeout in seconds (default 30; 60 with --preset ai-endpoint)')
  .option('--method <method>', 'HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS; default GET)')
  .option('--test-id <id>', 'Test UUID (required for synthetic_test)')
  .option('--port <port>', 'Port number (required for port_check)')
  .option('--protocol <protocol>', 'Port check protocol (tcp or udp, default tcp) or MCP protocol (auto, 2025, 2026; default auto)')
  .option('--preset <preset>', 'Request preset for http_request: ai-endpoint (OpenAI-compatible chat completions)')
  .option('--model <model>', 'Model name (ai-endpoint preset)')
  .option('--secret <name>', 'Project secret that holds the API key (ai-endpoint preset); omit to send no key')
  .option('--key-header <header>', 'Header for the key (ai-endpoint preset; Authorization sends Bearer <key>)')
  .option('--prompt <text>', 'Prompt to send (ai-endpoint preset)')
  .option('--expect <text>', 'Text the reply must contain (ai-endpoint preset)')
  .option('--max-tokens <n>', 'Token limit for the reply, 1-512 (ai-endpoint preset; reasoning models need more, e.g. 256)')
  .option('--first-token-timeout <ms>', 'Slower first token fails the check, 500-60000 ms (ai-endpoint preset)')
  .option('--warn-first-token-ms <ms>', 'Warn when the first token is slower than this for 3 checks in a row, 100-60000 ms (ai-endpoint preset)')
  .option('--warn-tokens <n>', 'Warn when a reply uses more than this many tokens (ai-endpoint preset)')
  .option('--header <name>', 'Send the secret in this header instead of as a bearer token (mcp_server; needs --secret)')
  .option('--require-tool <name>', 'Tool the server must list; repeat for several (mcp_server)', collect)
  .option('--call-tool <name>', 'Call this tool on every check; pick a read-only one (mcp_server)')
  .option('--call-args <json>', 'JSON object of arguments for --call-tool (mcp_server)')
  .option('--slow-ms <ms>', 'Warn when a check is slower than this for 3 checks in a row, 100-60000 ms (mcp_server)')
  .option('--dry-run', 'Show what would be sent without creating')
  .action(async (options: { name: string; url?: string; type: string; intervalMinutes: string; interval?: string; timeout?: string; method?: string; testId?: string; port?: string; protocol?: string; dryRun?: boolean; preset?: string; model?: string; secret?: string; keyHeader?: string; prompt?: string; expect?: string; maxTokens?: string; firstTokenTimeout?: string; warnFirstTokenMs?: string; warnTokens?: string; header?: string; requireTool?: string[]; callTool?: string; callArgs?: string; slowMs?: string; every?: string; grace?: string }) => {
    const client = createAuthenticatedClient()
    const monitorType = normalizeMonitorType(options.type)
    if (monitorType === 'heartbeat') {
      if (options.url !== undefined) throw new CLIError('--url is not used by heartbeat monitors; your job calls the ping URL instead.', ExitCode.ConfigError)
      if (!options.every) throw new CLIError('--every is required for heartbeat monitors (e.g. --every 1h).', ExitCode.ConfigError)
      buildAiEndpointPreset(options, monitorType)
      buildMcpConfig(options, monitorType)
      const graceMinutes = options.grace !== undefined ? parseDurationMinutes(options.grace, '--grace', HEARTBEAT_MAX_GRACE_MINUTES) : undefined
      const body: Record<string, unknown> = {
        name: options.name,
        target: '',
        type: monitorType,
        frequencyMinutes: parseDurationMinutes(options.every, '--every', HEARTBEAT_MAX_INTERVAL_MINUTES),
        config: graceMinutes !== undefined ? { heartbeat: { graceMinutes } } : {},
      }
      if (options.dryRun) {
        logger.header('Dry run — monitor create payload:')
        outputDetail({ dryRun: true, payload: body })
        return
      }
      const { data } = await withSpinner('Creating monitor', () => client.post<Record<string, unknown>>('/api/monitors', body))
      logger.success(`Monitor "${options.name}" created (${data.id})`)
      outputWithPingUrl(data, (data.heartbeat as Record<string, unknown> | undefined)?.pingUrl)
      return
    }
    if (options.every !== undefined || options.grace !== undefined) throw new CLIError('--every and --grace apply only to --type heartbeat.', ExitCode.ConfigError)
    // --secret and --expect are shared with the MCP flags, so they are not AI-preset strays for mcp_server.
    const aiEndpoint = buildAiEndpointPreset(monitorType === 'mcp_server' ? { ...options, secret: undefined, expect: undefined } : options, monitorType)
    const mcp = buildMcpConfig(options, monitorType)
    const method = normalizeHttpMethod(options.method ?? 'GET')
    if (monitorType !== 'synthetic_test' && !options.url) {
      throw new CLIError('--url is required for this monitor type.', ExitCode.ConfigError)
    }
    if (options.url) validateMonitorTarget(options.url, monitorType)
    if (monitorType === 'synthetic_test' && !z.string().uuid().safeParse(options.testId).success) {
      throw new CLIError('--test-id must be a valid test UUID for synthetic_test.', ExitCode.ConfigError)
    }
    if (monitorType === 'port_check' && !options.port) {
      throw new CLIError('--port is required for port_check.', ExitCode.ConfigError)
    }
    const portProtocol = options.protocol ?? 'tcp'
    if (monitorType === 'port_check' && !['tcp', 'udp'].includes(portProtocol)) {
      throw new CLIError('--protocol must be tcp or udp.', ExitCode.ConfigError)
    }

    let frequencyMinutes: number
    if (options.interval !== undefined) {
      logger.warn('--interval (seconds) is deprecated. Use --interval-minutes instead.')
      const intervalSeconds = parseIntStrict(options.interval, '--interval', { min: 60, max: 86400 })
      if (intervalSeconds % 60 !== 0) {
        throw new CLIError(
          `--interval must be a multiple of 60 seconds. Got ${intervalSeconds}s. Use --interval-minutes for direct minute values.`,
          ExitCode.ConfigError,
        )
      }
      frequencyMinutes = intervalSeconds / 60
    } else {
      frequencyMinutes = parseIntStrict(options.intervalMinutes, '--interval-minutes', { min: 1, max: 1440 })
    }

    const body: Record<string, unknown> = {
      name: options.name,
      target: options.url ?? '',
      type: monitorType,
      frequencyMinutes,
      config: mcp ? {
        timeoutSeconds: parseIntStrict(options.timeout ?? '30', '--timeout', { min: 5, max: 60 }),
        mcp,
      } : aiEndpoint ? {
        timeoutSeconds: parseIntStrict(options.timeout ?? '60', '--timeout', { min: 5, max: 120 }),
        aiEndpoint,
      } : {
        timeoutSeconds: parseIntStrict(options.timeout ?? '30', '--timeout', { min: 1, max: 3600 }),
        method,
        ...(monitorType === 'synthetic_test' ? { testId: options.testId } : {}),
        ...(monitorType === 'port_check' ? { port: parseIntStrict(options.port!, '--port', { min: 1, max: 65535 }), protocol: portProtocol } : {}),
      },
    }

    if (options.dryRun) {
      logger.header('Dry run — monitor create payload:')
      outputDetail({ dryRun: true, payload: body })
      return
    }

    const { data } = await withSpinner(
      'Creating monitor',
      () => client.post<Record<string, unknown>>('/api/monitors', body),
    )
    logger.success(`Monitor "${options.name}" created (${data.id})`)
    outputDetail(data)
  })

const isPlainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hasNull = (value: unknown): boolean => value === null || (typeof value === 'object' && Object.values(value as object).some(hasNull))
// The server's merge skips these keys at any depth, so they could never be stored.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const hasReservedKey = (value: unknown): boolean => isPlainObject(value) && Object.keys(value).some((key) => RESERVED_KEYS.has(key) || hasReservedKey(value[key]))
/** A JSON merge patch that turns `previous` into exactly `next`: the server merges nested objects, so stale keys are nulled at every level. */
export function replacementPatch(previous: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = Object.fromEntries(Object.keys(previous).filter((key) => !Object.hasOwn(next, key)).map((key) => [key, null]))
  for (const [key, value] of Object.entries(next)) {
    patch[key] = isPlainObject(value) && isPlainObject(previous[key]) ? replacementPatch(previous[key], value) : value
  }
  return patch
}

type ExistingMonitor = { type?: string; config?: { aiEndpoint?: Record<string, unknown>; mcp?: { auth?: { type?: string }; toolCall?: { name?: string; arguments?: Record<string, unknown> } } } }
const UPDATE_CHECK_FLAGS = ['model', 'secret', 'keyHeader', 'prompt', 'expect', 'maxTokens', 'firstTokenTimeout', 'warnFirstTokenMs', 'warnTokens', 'header', 'protocol', 'requireTool', 'callTool', 'callArgs', 'slowMs'] as const
type UpdateCheckOptions = { [K in (typeof UPDATE_CHECK_FLAGS)[number]]?: K extends 'requireTool' ? string[] : string }

/**
 * `monitor update` flags for AI endpoint and MCP monitors, as a merge patch of `config`: only the fields given change.
 * Each flag must fit the monitor it updates, so a typo cannot silently become a no-op.
 */
export function buildCheckConfigPatch(options: UpdateCheckOptions, existing: ExistingMonitor): Record<string, unknown> {
  const given = UPDATE_CHECK_FLAGS.filter((key) => options[key] !== undefined)
  if (given.length === 0) return {}
  if (existing.type === 'mcp_server') {
    const stray = given.find((key) => (AI_PRESET_ONLY as readonly string[]).includes(key) && key !== 'secret' && key !== 'expect')
    if (stray) throw new CLIError(`${flagName(stray)} applies only to AI endpoint monitors.`, ExitCode.ConfigError)
    const mcp: Record<string, unknown> = {}
    const authType = existing.config?.mcp?.auth?.type
    if (options.header !== undefined && options.secret === undefined && authType !== 'bearer' && authType !== 'header') {
      throw new CLIError('--header requires --secret.', ExitCode.ConfigError)
    }
    // --secret alone keeps the current auth style: a header monitor keeps its header name.
    if (options.secret !== undefined) mcp.auth = options.header !== undefined
      ? { type: 'header', secretKey: options.secret, headerName: options.header }
      : authType === 'header' ? { type: 'header', secretKey: options.secret } : { type: 'bearer', secretKey: options.secret }
    else if (options.header !== undefined) mcp.auth = { type: 'header', headerName: options.header }
    if (options.protocol !== undefined) {
      if (!['auto', '2025', '2026'].includes(options.protocol)) throw new CLIError('--protocol must be auto, 2025 or 2026 for mcp_server.', ExitCode.ConfigError)
      mcp.protocol = options.protocol
    }
    if (options.requireTool !== undefined) mcp.requiredTools = options.requireTool
    if (options.slowMs !== undefined) mcp.slowMs = parseIntStrict(options.slowMs, '--slow-ms', { min: 100, max: 60000 })
    const toolCall: Record<string, unknown> = {}
    const previousCall = existing.config?.mcp?.toolCall
    if ((options.expect !== undefined || options.callArgs !== undefined) && options.callTool === undefined && !previousCall?.name) {
      throw new CLIError('--call-args and --expect require --call-tool.', ExitCode.ConfigError)
    }
    if (options.callTool !== undefined) {
      toolCall.name = options.callTool
      // A different tool does not inherit the previous tool's arguments or expected text.
      if (options.callTool !== previousCall?.name) Object.assign(toolCall, { arguments: null, expectText: null })
    }
    if (options.expect !== undefined) toolCall.expectText = options.expect
    if (options.callArgs !== undefined) {
      let args: unknown
      try { args = JSON.parse(options.callArgs) } catch { args = undefined }
      if (!isPlainObject(args)) throw new CLIError('--call-args must be a JSON object.', ExitCode.ConfigError)
      if (hasNull(args)) throw new CLIError('--call-args cannot contain null values.', ExitCode.ConfigError)
      if (hasReservedKey(args)) throw new CLIError('--call-args cannot use the keys __proto__, constructor or prototype.', ExitCode.ConfigError)
      toolCall.arguments = replacementPatch(isPlainObject(previousCall?.arguments) ? previousCall.arguments : {}, args)
    }
    if (Object.keys(toolCall).length > 0) mcp.toolCall = toolCall
    return { mcp }
  }
  if (!existing.config?.aiEndpoint) {
    throw new CLIError(`${flagName(given[0])} applies only to AI endpoint and MCP server monitors; this monitor is neither.`, ExitCode.ConfigError)
  }
  const stray = given.find((key) => !(AI_PRESET_ONLY as readonly string[]).includes(key))
  if (stray) throw new CLIError(`${flagName(stray)} applies only to MCP server monitors.`, ExitCode.ConfigError)
  const aiEndpoint: Record<string, unknown> = {}
  if (options.model !== undefined) {
    if (!options.model.trim()) throw new CLIError('--model cannot be empty.', ExitCode.ConfigError)
    aiEndpoint.model = options.model.trim()
  }
  if (options.secret !== undefined) aiEndpoint.secretKey = options.secret
  if (options.keyHeader !== undefined) aiEndpoint.keyHeader = options.keyHeader
  if (options.prompt !== undefined) aiEndpoint.prompt = options.prompt
  if (options.expect !== undefined) aiEndpoint.expectText = options.expect
  if (options.maxTokens !== undefined) aiEndpoint.maxTokens = parseIntStrict(options.maxTokens, '--max-tokens', { min: 1, max: 512 })
  if (options.firstTokenTimeout !== undefined) aiEndpoint.firstTokenTimeoutMs = parseIntStrict(options.firstTokenTimeout, '--first-token-timeout', { min: 500, max: 60000 })
  if (options.warnFirstTokenMs !== undefined) aiEndpoint.warnFirstTokenMs = parseIntStrict(options.warnFirstTokenMs, '--warn-first-token-ms', { min: 100, max: 60000 })
  if (options.warnTokens !== undefined) aiEndpoint.warnTotalTokens = parseIntStrict(options.warnTokens, '--warn-tokens', { min: 1, max: 1000000 })
  return { aiEndpoint }
}

monitorCommand
  .command('update <id>')
  .description('Update a monitor')
  .option('--name <name>', 'Monitor name')
  .option('--url <url>', 'URL to monitor')
  .option('--interval-minutes <minutes>', 'Check interval in minutes (1-1440)')
  .option('--interval <seconds>', '[deprecated: use --interval-minutes] Check interval in seconds')
  .option('--every <duration>', 'Heartbeat: expected ping interval, e.g. 5m, 1h, 1d (up to 31d)')
  .option('--grace <duration>', 'Heartbeat: grace period, e.g. 10m (up to 1d)')
  .option('--timeout <seconds>', 'Request timeout in seconds')
  .option('--method <method>', 'HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)')
  .option('--active <boolean>', 'Enable or disable monitor (true/false)')
  .option('--model <model>', 'Model name (AI endpoint monitor)')
  .option('--secret <name>', 'Project secret that holds the API key (AI endpoint) or the login (mcp_server)')
  .option('--key-header <header>', 'Header for the key (AI endpoint; Authorization sends Bearer <key>)')
  .option('--prompt <text>', 'Prompt to send (AI endpoint)')
  .option('--expect <text>', 'Text the reply must contain (AI endpoint) or the --call-tool result must contain (mcp_server)')
  .option('--max-tokens <n>', 'Token limit for the reply, 1-512 (AI endpoint)')
  .option('--first-token-timeout <ms>', 'Slower first token fails the check, 500-60000 ms (AI endpoint)')
  .option('--warn-first-token-ms <ms>', 'Warn when the first token is slower than this for 3 checks in a row, 100-60000 ms (AI endpoint)')
  .option('--warn-tokens <n>', 'Warn when a reply uses more than this many tokens (AI endpoint)')
  .option('--header <name>', 'Send the secret in this header instead of as a bearer token (mcp_server)')
  .option('--protocol <protocol>', 'MCP protocol: auto, 2025 or 2026 (mcp_server)')
  .option('--require-tool <name>', 'Tool the server must list; repeat for several, replaces the list (mcp_server)', collect)
  .option('--call-tool <name>', 'Call this tool on every check; pick a read-only one (mcp_server)')
  .option('--call-args <json>', 'JSON object of arguments for the tool call, replaces the previous ones (mcp_server)')
  .option('--slow-ms <ms>', 'Warn when a check is slower than this for 3 checks in a row, 100-60000 ms (mcp_server)')
  .option('--dry-run', 'Show what would be sent without updating')
  .action(async (id: string, options: { name?: string; url?: string; intervalMinutes?: string; interval?: string; every?: string; grace?: string; timeout?: string; method?: string; active?: string; dryRun?: boolean } & UpdateCheckOptions) => {
    const client = createAuthenticatedClient()

    const body: Record<string, unknown> = {}
    if (options.name !== undefined) body.name = options.name
    const needsExisting = options.url !== undefined || UPDATE_CHECK_FLAGS.some((key) => options[key] !== undefined)
    const existing = needsExisting
      ? (await client.get<ExistingMonitor>(`/api/monitors/${encodeURIComponent(id)}`)).data
      : undefined
    if (options.url !== undefined) {
      validateMonitorTarget(options.url, existing?.type)
      body.target = options.url
    }
    if (options.interval !== undefined) {
      logger.warn('--interval (seconds) is deprecated. Use --interval-minutes instead.')
      const intervalSeconds = parseIntStrict(options.interval, '--interval', { min: 60, max: 86400 })
      if (intervalSeconds % 60 !== 0) {
        throw new CLIError(
          `--interval must be a multiple of 60 seconds. Got ${intervalSeconds}s. Use --interval-minutes for direct minute values.`,
          ExitCode.ConfigError,
        )
      }
      body.frequencyMinutes = intervalSeconds / 60
    } else if (options.intervalMinutes !== undefined) {
      body.frequencyMinutes = parseIntStrict(options.intervalMinutes, '--interval-minutes', { min: 1, max: 1440 })
    }
    if (options.every !== undefined) body.frequencyMinutes = parseDurationMinutes(options.every, '--every', HEARTBEAT_MAX_INTERVAL_MINUTES)
    if (options.active !== undefined) body.enabled = parseBooleanStrict(options.active, '--active')

    // timeout and method go in config object
    const config: Record<string, unknown> = {}
    if (options.timeout !== undefined) config.timeoutSeconds = parseIntStrict(options.timeout, '--timeout', { min: 1, max: 3600 })
    if (options.method !== undefined) config.method = normalizeHttpMethod(options.method)
    if (options.grace !== undefined) config.heartbeat = { graceMinutes: parseDurationMinutes(options.grace, '--grace', HEARTBEAT_MAX_GRACE_MINUTES) }
    if (existing) Object.assign(config, buildCheckConfigPatch(options, existing))
    if (Object.keys(config).length > 0) body.config = config

    if (Object.keys(body).length === 0) {
      throw new CLIError('No fields to update. Use --name, --url, --interval-minutes, --every, --grace, --timeout, --method, --active, or an AI endpoint or MCP monitor option.', ExitCode.ConfigError)
    }

    if (options.dryRun) {
      logger.header('Dry run — monitor update payload:')
      outputDetail({ dryRun: true, payload: body })
      return
    }

    const { data } = await withSpinner(
      'Updating monitor',
      () => client.patch<Record<string, unknown>>(`/api/monitors/${encodeURIComponent(id)}`, body),
    )
    logger.success(`Monitor ${id} updated`)
    outputDetail(data)
  })

monitorCommand
  .command('delete <id>')
  .description('Delete a monitor')
  .option('--force', 'Skip confirmation')
  .action(async (id: string, options: { force?: boolean }) => {
    if (!options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Delete monitor ${id}?`, { default: false })
    }

    const client = createAuthenticatedClient()
    await withSpinner(
      'Deleting monitor',
      () => client.delete(`/api/monitors/${encodeURIComponent(id)}`),
    )
    logger.success(`Monitor ${id} deleted`)
    outputMutation({ id, deleted: true })
  })

monitorCommand
  .command('heartbeat-url <id>')
  .description('Show the ping URL of a heartbeat monitor, or replace it with --rotate')
  .option('--rotate', 'Issue a new ping URL; the old one stops working at once')
  .option('--force', 'Skip the rotate confirmation')
  .action(async (id: string, options: { rotate?: boolean; force?: boolean }) => {
    if (options.rotate && !options.force) {
      const { confirmPrompt } = await import('../utils/prompt.js')
      await confirmPrompt(`Rotate the ping URL of monitor ${id}? The old URL stops working at once.`, { default: false })
    }
    const client = createAuthenticatedClient()
    const path = `/api/monitors/${encodeURIComponent(id)}/heartbeat-url`
    const { data } = await withSpinner(
      options.rotate ? 'Rotating ping URL' : 'Fetching ping URL',
      () => options.rotate ? client.post<{ pingUrl?: string }>(`${path}/rotate`, {}, { retries: 0 }) : client.get<{ pingUrl?: string }>(path),
    )
    if (typeof data.pingUrl !== 'string') throw new CLIError('The server did not return a ping URL. Is this a heartbeat monitor?', ExitCode.ApiError)
    if (options.rotate) logger.success(`Ping URL of monitor ${id} rotated`)
    if (getOutputFormat() === 'quiet') logger.output(data.pingUrl, { redact: false })
    else outputWithPingUrl({ id, pingUrl: data.pingUrl }, data.pingUrl)
  })
