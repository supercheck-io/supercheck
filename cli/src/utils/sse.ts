import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'
import { CLI_VERSION } from '../version.js'
import { ApiRequestError, CLIError, ExitCode, networkErrorMessage } from './errors.js'
import { getProxyAgent, getProxyEnv } from './proxy.js'

import { createSpinner } from './spinner.js'

const MAX_EVENT_BYTES = 1024 * 1024

export type SseEvent = { event: string; data: unknown }

/** Returns true for the event that marks a stream as completed by the server. */
export type SseTerminalPredicate = (event: SseEvent) => boolean

export interface SseOptions {
  idleTimeoutMs?: number
  /** When set, a stream that closes before this returns true is treated as truncated. */
  isTerminal?: SseTerminalPredicate
}

async function streamSse(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void | false,
  { idleTimeoutMs = 60_000, isTerminal }: SseOptions = {},
): Promise<void> {
  const token = requireAuth()
  const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}${path}`)
  const controller = new AbortController()
  let interrupted = false
  const onInterrupt = () => { interrupted = true; controller.abort() }
  process.once('SIGINT', onInterrupt)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }

  const started = Date.now()
  const spinner = createSpinner('Connecting to stream…').start()
  let phase = 'Connecting to stream'
  const progressTimer = setInterval(() => { spinner.text = `${phase}… ${Math.floor((Date.now() - started) / 1000)}s` }, 1000)
  try {
    const proxy = getProxyEnv(url)
    resetIdleTimer()
    let response: Response | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
            'User-Agent': `supercheck-cli/${CLI_VERSION}`,
          },
          ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
          ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
          signal: controller.signal,
        })
        break
      } catch (error) {
        if (method !== 'GET' || attempt > 0 || controller.signal.aborted) throw error
        phase = 'Reconnecting to stream'
      }
    }
    if (!response) throw new CLIError('Stream connection failed', ExitCode.ApiError)
    phase = 'Subscribed — waiting for output'
    if (!response.ok) {
      const details = (await response.text()).slice(0, 4096)
      let parsed: unknown = details
      try { parsed = JSON.parse(details) } catch { /* Keep the raw text body. */ }
      throw new ApiRequestError(`Stream request failed (${response.status})${details ? `: ${details}` : ''}`, response.status, parsed)
    }
    reader = response.body?.getReader()
    if (!reader) throw new CLIError('Stream returned no response body', ExitCode.ApiError)

    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let dataLines: string[] = []
    let eventBytes = 0
    let completed = false
    const dispatch = () => {
      if (dataLines.length === 0) return
      const raw = dataLines.join('\n')
      let data: unknown = raw
      try { data = JSON.parse(raw) } catch { /* Preserve plain-text SSE data. */ }
      if (!['ready', 'heartbeat'].includes(eventName)) spinner.stop()
      const sseEvent = { event: eventName, data }
      const keepReading = onEvent(sseEvent)
      if (isTerminal?.(sseEvent)) completed = true
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (eventName === 'error' || record.type === 'error') {
        throw new CLIError(String(record.message ?? record.error ?? 'Stream failed'), ExitCode.ApiError)
      }
      if (eventName === 'agent.fallback') {
        throw new CLIError('Copilot is temporarily unavailable. Check the AI provider configuration and retry.', ExitCode.ApiError)
      }
      dataLines = []
      return keepReading
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        // Flush the decoder and any frame the server did not terminate with a blank line.
        buffer += decoder.decode()
        for (const line of buffer.split(/\r?\n/)) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message'
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
        }
        if (dispatch() === false) return
        break
      }
      resetIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line === '') {
          if (dispatch() === false) return
          eventName = 'message'
          eventBytes = 0
          continue
        }
        eventBytes += Buffer.byteLength(line, 'utf8')
        if (eventBytes > MAX_EVENT_BYTES) {
          throw new CLIError('Stream event exceeded the 1 MiB safety limit', ExitCode.ApiError)
        }
        if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message'
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      }
      if (eventBytes + Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_BYTES) {
        throw new CLIError('Stream event exceeded the 1 MiB safety limit', ExitCode.ApiError)
      }
    }
    if (isTerminal && !completed) {
      throw new CLIError('Stream ended before the server reported completion. The connection may have been closed by a proxy; retry the command.', ExitCode.ApiError)
    }
  } catch (error) {
    if (error instanceof CLIError) throw error
    if (controller.signal.aborted) {
      throw new CLIError(interrupted ? 'Cancelled' : `Stream timed out after ${idleTimeoutMs / 1000}s without data`, interrupted ? ExitCode.Interrupted : ExitCode.Timeout)
    }
    throw new CLIError(`Stream failed: ${networkErrorMessage(error)}`, ExitCode.ApiError)
  } finally {
    spinner.stop()
    clearInterval(progressTimer)
    await reader?.cancel().catch(() => undefined)
    controller.abort()
    if (idleTimer) clearTimeout(idleTimer)
    process.removeListener('SIGINT', onInterrupt)
  }
}

export function postSse(path: string, body: unknown, onEvent: (event: SseEvent) => void | false, options: SseOptions | number = {}): Promise<void> {
  return streamSse('POST', path, body, onEvent, typeof options === 'number' ? { idleTimeoutMs: options } : options)
}

export function getSse(path: string, onEvent: (event: SseEvent) => void | false, options: SseOptions | number = {}): Promise<void> {
  return streamSse('GET', path, undefined, onEvent, typeof options === 'number' ? { idleTimeoutMs: options } : options)
}
