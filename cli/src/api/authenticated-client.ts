import { getApiClient } from './client.js'
import { requireAuth, getStoredBaseUrl } from '../auth/store.js'
import { loadConfig, tryLoadConfig, type LoadConfigOptions } from '../config/loader.js'
import type { ApiClient } from './client.js'
import { logger } from '../utils/logger.js'

let resolvedConfigBaseUrl: string | null = null

export function getResolvedConfigBaseUrl(): string | null {
  return resolvedConfigBaseUrl
}

export function setResolvedConfigBaseUrl(baseUrl: string | null): void {
  resolvedConfigBaseUrl = baseUrl
}

export async function resolveAndSetConfigBaseUrl(
  options: LoadConfigOptions = {},
): Promise<string | null> {
  const resolved = await resolveConfigBaseUrl(options)
  setResolvedConfigBaseUrl(resolved)
  return resolved
}

async function resolveConfigBaseUrl(options: LoadConfigOptions = {}): Promise<string | null> {
  if (options.configPath) {
    const result = await loadConfig(options)
    return result.config.api?.baseUrl ?? null
  }

  try {
    const result = await tryLoadConfig(options)
    return result?.config?.api?.baseUrl ?? null
  } catch (err) {
    logger.debug(
      `Skipping config base URL fallback: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }
}

/**
 * Create an API client pre-configured with the stored auth token and base URL.
 * Shared across all command modules to avoid repeating this pattern.
 *
 * Base URL resolution order (highest to lowest priority):
 *  1. SUPERCHECK_URL environment variable (via getStoredBaseUrl)
 *  2. Stored base URL from `supercheck login --url` (via getStoredBaseUrl)
 *  3. Config file `api.baseUrl` (from supercheck.config.ts)
 *  4. Default: https://app.supercheck.io
 */
export function createAuthenticatedClient(configBaseUrl?: string): ApiClient {
  const token = requireAuth()
  const storedBaseUrl = getStoredBaseUrl()
  const baseUrl = storedBaseUrl ?? configBaseUrl ?? resolvedConfigBaseUrl
  return getApiClient({ token, baseUrl: baseUrl ?? undefined })
}

/**
 * Create an authenticated client with config-aware base URL resolution.
 * Attempts to load the config file to read `api.baseUrl` as a fallback.
 * Use this variant in commands that don't already load the config.
 */
export async function createAuthenticatedClientWithConfig(): Promise<ApiClient> {
  const token = requireAuth()
  const storedBaseUrl = getStoredBaseUrl()

  if (storedBaseUrl) {
    return getApiClient({ token, baseUrl: storedBaseUrl })
  }

  const configBaseUrl = await resolveAndSetConfigBaseUrl()
  return getApiClient({ token, baseUrl: configBaseUrl ?? undefined })
}
