import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { getResolvedConfigBaseUrl } from '../api/authenticated-client.js'
import { CLI_VERSION } from '../version.js'
import { CLIError, ExitCode } from './errors.js'
import { getProxyAgent, getProxyEnv } from './proxy.js'

const MAX_EVENT_BYTES = 1024 * 1024

export type SseEvent = { event: string; data: unknown }

export async function postSse(
  path: string,
  body: unknown,
  onEvent: (event: SseEvent) => void,
  idleTimeoutMs = 60_000,
): Promise<void> {
  const token = requireAuth()
  const baseUrl = getStoredBaseUrl() ?? getResolvedConfigBaseUrl() ?? 'https://app.supercheck.io'
  const url = new URL(path, `${baseUrl}/`)
  const controller = new AbortController()
  const onInterrupt = () => controller.abort()
  process.once('SIGINT', onInterrupt)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs)
  }

  try {
    const proxy = getProxyEnv(url)
    resetIdleTimer()
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
        'User-Agent': `supercheck-cli/${CLI_VERSION}`,
      },
      body: JSON.stringify(body),
      ...(proxy ? { dispatcher: getProxyAgent(proxy) } : {}),
      signal: controller.signal,
    })
    if (!response.ok) {
      const details = (await response.text()).slice(0, 4096)
      throw new CLIError(`SRE stream request failed (${response.status})${details ? `: ${details}` : ''}`, ExitCode.ApiError)
    }
    const reader = response.body?.getReader()
    if (!reader) throw new CLIError('SRE stream returned no response body', ExitCode.ApiError)

    const decoder = new TextDecoder()
    let buffer = ''
    let eventName = 'message'
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdleTimer()
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_EVENT_BYTES) {
        throw new CLIError('SRE stream event exceeded the 1 MiB safety limit', ExitCode.ApiError)
      }
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim() || 'message'
        else if (line.startsWith('data:')) {
          const raw = line.slice(5).trimStart()
          let data: unknown = raw
          try { data = JSON.parse(raw) } catch { /* Preserve valid plain-text SSE data. */ }
          onEvent({ event: eventName, data })
          eventName = 'message'
        }
      }
    }
  } catch (error) {
    if (error instanceof CLIError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CLIError('SRE stream was cancelled or timed out', ExitCode.Timeout)
    }
    throw new CLIError(`SRE stream failed: ${error instanceof Error ? error.message : String(error)}`, ExitCode.ApiError)
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
    process.removeListener('SIGINT', onInterrupt)
  }
}
