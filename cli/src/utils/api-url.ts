/** The bearer token may only travel over HTTPS, or HTTP to a loopback host. */
export function isTokenSafeUrl(baseUrl: string): boolean {
  try {
    const { protocol, hostname, username, password } = new URL(baseUrl)
    if (username || password) return false
    return protocol === 'https:' || (protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname))
  } catch { return false }
}

/** Origin plus any sub-path; never credentials, query or fragment. Returns null for anything else. */
export function sanitizeApiUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch { return null }
}
