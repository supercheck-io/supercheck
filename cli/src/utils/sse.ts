import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'
import { CLI_VERSION } from '../version.js'
import { CLIError, ExitCode } from './errors.js'
import { getProxyAgent, getProxyEnv } from './proxy.js'

const MAX_EVENT_BYTES = 1024 * 1024

export type SseEvent = { event: string; data: unknown }

async function streamSse(
  method: 'GET' | 'POST',
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void | false,
  idleTimeoutMs = 60_000,
): Promise<void> {
  const token = requireAuth()
  const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
  const url = new URL(path, `${baseUrl}/`)
  const controller = new AbortController()
  const onInterrupt = () => controller.abort()
  process.once('SIGINT', onInterrupt)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }

  try {
    const proxy = getProxyEnv(url)
    resetIdleTimer()
    const response = await fetch(url, {
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
    if (!response.ok) {
      const details = (await response.text()).slice(0, 4096)
      throw new CLIError(`SRE stream request failed (${response.status})${details ? `: ${details}` : ''}`, ExitCode.ApiError)
    }
    reader = response.body?.getReader()
    if (!reader) throw new CLIError('SRE stream returned no response body', ExitCode.ApiError)

    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    let dataLines: string[] = []
    let eventBytes = 0
    const dispatch = () => {
      if (dataLines.length === 0) return
      const raw = dataLines.join('\n')
      let data: unknown = raw
      try { data = JSON.parse(raw) } catch { /* Preserve plain-text SSE data. */ }
      const keepReading = onEvent({ event: eventName, data })
      const record = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      if (eventName === 'error' || record.type === 'error') {
        throw new CLIError(String(record.message ?? record.error ?? 'SRE stream failed'), ExitCode.ApiError)
      }
      if (eventName === 'agent.fallback') {
        throw new CLIError('Copilot is temporarily unavailable. Check the AI provider configuration and retry.', ExitCode.ApiError)
      }
      dataLines = []
      return keepReading
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
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
          throw new CLIError('SRE stream event exceeded the 1 MiB safety limit', ExitCode.ApiError)
        }
        if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message'
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      }
      if (eventBytes + Buffer.byteLength(buffer, 'utf8') > MAX_EVENT_BYTES) {
        throw new CLIError('SRE stream event exceeded the 1 MiB safety limit', ExitCode.ApiError)
      }
    }
  } catch (error) {
    if (error instanceof CLIError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CLIError('SRE stream was cancelled or timed out', ExitCode.Timeout)
    }
    throw new CLIError(`SRE stream failed: ${error instanceof Error ? error.message : String(error)}`, ExitCode.ApiError)
  } finally {
    await reader?.cancel().catch(() => undefined)
    controller.abort()
    if (idleTimer) clearTimeout(idleTimer)
    process.removeListener('SIGINT', onInterrupt)
  }
}

export function postSse(path: string, body: unknown, onEvent: (event: SseEvent) => void | false, idleTimeoutMs = 60_000): Promise<void> {
  return streamSse('POST', path, body, onEvent, idleTimeoutMs)
}

export function getSse(path: string, onEvent: (event: SseEvent) => void | false, idleTimeoutMs = 60_000): Promise<void> {
  return streamSse('GET', path, undefined, onEvent, idleTimeoutMs)
}
