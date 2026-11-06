import { CLIError, ExitCode } from './errors.js'

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

/**
 * Paths interpolate user-supplied IDs, and new URL() silently resolves dot segments, treats `\` as `/` and drops
 * tabs/newlines, any of which would send the request to another resource. Reject them before parsing.
 */
export function assertSafeApiPath(path: string): void {
  const pathname = path.split(/[?#]/, 1)[0]
  const unsafeChar = [...path].some((char) => char === '\\' || char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)
  if (unsafeChar || pathname.split('/').some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) {
    throw new CLIError(`Invalid resource path: ${JSON.stringify(pathname)}`, ExitCode.ConfigError)
  }
}
