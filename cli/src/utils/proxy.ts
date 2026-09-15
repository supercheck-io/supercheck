import { ProxyAgent } from 'undici'

/**
 * Shared ProxyAgent cache — avoids creating duplicate agents
 * for the same proxy URL within a single CLI run.
 */
const proxyAgents = new Map<string, ProxyAgent>()

export function getProxyAgent(proxyUrl: string): ProxyAgent {
  const existing = proxyAgents.get(proxyUrl)
  if (existing) return existing
  const created = new ProxyAgent(proxyUrl)
  proxyAgents.set(proxyUrl, created)
  return created
}

/**
 * Clear all cached ProxyAgent instances (useful for testing).
 */
export function clearProxyAgents(): void {
  proxyAgents.clear()
}

/**
 * Check if a URL matches the NO_PROXY exclusion list.
 */
export function isNoProxyMatch(url: URL, noProxyRaw: string): boolean {
  const hostname = url.hostname
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  const entries = noProxyRaw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

  if (entries.includes('*')) return true

  for (const entry of entries) {
    const [hostPart, portPart] = entry.split(':')
    const host = hostPart.trim()
    const entryPort = portPart?.trim()

    if (!host) continue
    if (entryPort && entryPort !== port) continue

    if (host.startsWith('.')) {
      if (hostname.endsWith(host)) return true
      continue
    }

    if (hostname === host) return true
    if (hostname.endsWith(`.${host}`)) return true
  }

  return false
}

/**
 * Get the appropriate proxy URL from environment variables for a given URL.
 * Respects HTTPS_PROXY, HTTP_PROXY, and NO_PROXY conventions.
 */
export function getProxyEnv(url: URL): string | null {
  const noProxyRaw = process.env.NO_PROXY ?? process.env.no_proxy
  if (noProxyRaw && isNoProxyMatch(url, noProxyRaw)) {
    return null
  }

  if (url.protocol === 'https:') {
    return (
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy ??
      null
    )
  }

  if (url.protocol === 'http:') {
    return process.env.HTTP_PROXY ?? process.env.http_proxy ?? null
  }

  return null
}
