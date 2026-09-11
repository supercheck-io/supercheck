import { ApiRequestError, TimeoutError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { CLI_VERSION } from '../version.js'
import { getProxyAgent as getSharedProxyAgent, clearProxyAgents, getProxyEnv } from '../utils/proxy.js'

export { clearProxyAgents }

const DEFAULT_BASE_URL = 'https://app.supercheck.io'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = 1_000

export interface ApiClientOptions {
  baseUrl?: string
  token?: string
  timeout?: number
  proxy?: string
}

export interface ApiResponse<T = unknown> {
  data: T
  status: number
  headers: Headers
}

export interface PaginatedResponse<T = unknown> {
  data: T[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

export class ApiClient {
  private baseUrl: string
  private token: string | null
  private timeout: number
  private proxy: string | null

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.token = options.token ?? null
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS
    this.proxy = options.proxy ?? null
  }

  setToken(token: string): void {
    this.token = token
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url.replace(/\/$/, '')
  }

  setTimeout(timeout: number): void {
    this.timeout = timeout
  }

  setProxy(proxy: string | null): void {
    this.proxy = proxy
  }

  private buildHeaders(extraHeaders?: Record<string, string>): Headers {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'User-Agent': `supercheck-cli/${CLI_VERSION}`,
      ...extraHeaders,
    })

    if (this.token) {
      headers.set('Authorization', `Bearer ${this.token}`)
    }

    return headers
  }

  private buildUrl(path: string, params?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }
    return url.toString()
  }

  /**
   * Execute an HTTP request with retries, timeout, and rate limit handling.
   *
   * Retry policy:
   * - 429 (rate limit): retried for all methods (with Retry-After header)
   * - 5xx (server error): retried only for idempotent methods (GET, PUT, DELETE, HEAD, OPTIONS)
   * - Network errors: retried only for idempotent methods
   * - POST and PATCH are NOT retried on 5xx/network errors to prevent duplicate mutations
   */
  async request<T = unknown>(
    method: string,
    path: string,
    options?: {
      body?: unknown
      params?: Record<string, string | number | boolean | undefined>
      headers?: Record<string, string>
      retries?: number
    },
  ): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, options?.params)
    const parsedUrl = new URL(url)
    const headers = this.buildHeaders(options?.headers)
    const maxRetries = options?.retries ?? MAX_RETRIES

    // Only retry idempotent methods on server errors and network failures.
    // POST and PATCH are non-idempotent — retrying them risks duplicate creates/triggers/deletes.
    const upperMethod = method.toUpperCase()
    const isIdempotent = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(upperMethod)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      try {
        const controller = new AbortController()
        timeoutId = setTimeout(() => controller.abort(), this.timeout)

        // Use explicitly-set proxy, otherwise resolve from env vars (NO_PROXY-aware)
        const proxy = this.proxy || getProxyEnv(parsedUrl)
        const fetchOptions: RequestInit & { dispatcher?: unknown } = {
          method,
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        }

        if (proxy) {
          fetchOptions.dispatcher = getSharedProxyAgent(proxy)
        }

        const response = await fetch(url, fetchOptions)

        clearTimeout(timeoutId)
        timeoutId = null

        // Rate limit handling
        if (response.status === 429) {
          if (attempt >= maxRetries) {
            throw new ApiRequestError(
              `Rate limited after ${maxRetries + 1} attempts: ${method} ${path}`,
              429,
            )
          }

          const retryAfter = response.headers.get('Retry-After')
          const parsedSeconds = retryAfter ? Number(retryAfter) : NaN
          const waitMs = Number.isFinite(parsedSeconds) && parsedSeconds > 0
            ? parsedSeconds * 1000
            : RETRY_BACKOFF_MS * Math.pow(2, attempt)

          logger.warn(`Rate limited. Retrying in ${Math.round(waitMs / 1000)}s...`)
          await this.sleep(waitMs)
          continue
        }

        // Server error — retry only for idempotent methods
        if (response.status >= 500 && attempt < maxRetries && isIdempotent) {
          const waitMs = RETRY_BACKOFF_MS * Math.pow(2, attempt)
          logger.debug(`Server error ${response.status}. Retrying in ${waitMs}ms...`)
          await this.sleep(waitMs)
          continue
        }

        // Read response body as text first to safely handle empty/non-JSON responses (e.g. 204 No Content)
        const text = await response.text()

        // Client error — don't retry
        if (!response.ok) {
          let responseBody: unknown
          try {
            responseBody = JSON.parse(text)
          } catch {
            responseBody = text
          }

          throw new ApiRequestError(
            `API request failed: ${method} ${path} → ${response.status}`,
            response.status,
            responseBody,
          )
        }

        const data = text ? (JSON.parse(text) as T) : ({} as T)

        return {
          data,
          status: response.status,
          headers: response.headers,
        }
      } catch (err) {
        if (err instanceof ApiRequestError) throw err

        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new TimeoutError(`Request timed out after ${this.timeout}ms: ${method} ${path}`)
        }

        lastError = err as Error

        // Non-idempotent methods (POST, PATCH) must NOT be retried on network errors to prevent duplicate mutations
        if (!isIdempotent) {
          throw new ApiRequestError(
            `Request failed: ${(err as Error).message ?? 'Network error'}`,
          )
        }

        if (attempt < maxRetries) {
          const waitMs = RETRY_BACKOFF_MS * Math.pow(2, attempt)
          logger.debug(`Network error: ${(err as Error).message}. Retrying in ${waitMs}ms...`)
          await this.sleep(waitMs)
        }
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId)
      }
    }

    throw new ApiRequestError(
      `Request failed after ${maxRetries + 1} attempts: ${lastError?.message ?? 'Unknown error'}`,
    )
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, { params })
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, { body })
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, { body })
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, { body })
  }

  async delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

let defaultClient: ApiClient | null = null

/**
 * Get or create the default API client singleton.
 * If options are provided and a client already exists, the token and baseUrl
 * are updated to reflect the caller's intent (e.g., after login).
 */
export function getApiClient(options?: ApiClientOptions): ApiClient {
  if (!defaultClient) {
    defaultClient = new ApiClient(options)
  } else if (options) {
    if (options.token !== undefined) defaultClient.setToken(options.token)
    if (options.baseUrl !== undefined) defaultClient.setBaseUrl(options.baseUrl)
    if (options.timeout !== undefined) defaultClient.setTimeout(options.timeout)
    if (options.proxy !== undefined) defaultClient.setProxy(options.proxy)
  }
  return defaultClient
}

/**
 * Reset the default API client (useful for testing).
 */
export function resetApiClient(): void {
  defaultClient = null
}
