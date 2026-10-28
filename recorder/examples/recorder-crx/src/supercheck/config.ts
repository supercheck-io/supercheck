/**
 * Supercheck Recorder - Configuration Management
 *
 * Manages Supercheck instance URL and authentication configuration.
 * Default: app.supercheck.io (cloud) - works seamlessly without any setup.
 * Self-hosted users can configure via options page.
 */

export interface SupercheckConfig {
  instanceUrl: string;
  apiKey?: string;
  keyId?: string; // server id of apiKey, reported so the app can detect a lost key
  userId?: string;
  userEmail?: string;
  lastProjectId?: string;
  autoConnected?: boolean; // True if connected via seamless auth
}

import type { AutoConnectPayload } from './message-security';
import { isSupercheckCloudOrigin } from './message-security';

function isConfig(value: unknown): value is SupercheckConfig {
  return !!value && typeof value === 'object' && 'instanceUrl' in value && typeof value.instanceUrl === 'string';
}

const STORAGE_KEY = 'supercheckConfig';
const DEFAULT_INSTANCE_URL = 'https://app.supercheck.io';

// Default config - extension works with app.supercheck.io out of the box
const DEFAULT_CONFIG: SupercheckConfig = {
  instanceUrl: DEFAULT_INSTANCE_URL,
  autoConnected: false,
};

/**
 * Read the stored config from local storage. The API key must never sit in
 * chrome.storage.sync (it replicates to the browser vendor's cloud), so a copy
 * found there by an older version is moved to local storage and removed.
 */
async function readStoredConfig(): Promise<Partial<SupercheckConfig> | undefined> {
  const local = (await chrome.storage.local.get<{ supercheckConfig?: Partial<SupercheckConfig> }>(STORAGE_KEY))[STORAGE_KEY];
  if (local)
    return local;
  const synced = (await chrome.storage.sync.get<{ supercheckConfig?: Partial<SupercheckConfig> }>(STORAGE_KEY))[STORAGE_KEY];
  if (synced) {
    await chrome.storage.local.set({ [STORAGE_KEY]: synced });
    await chrome.storage.sync.remove(STORAGE_KEY);
  }
  return synced;
}

/**
 * Get the current Supercheck configuration
 * Returns default config if none exists (enables seamless operation)
 */
export async function getConfig(): Promise<SupercheckConfig> {
  try {
    return { ...DEFAULT_CONFIG, ...await readStoredConfig() };
  } catch (error) {
    console.error('[Supercheck] Failed to get config:', error);
    return DEFAULT_CONFIG;
  }
}

/**
 * Save Supercheck configuration
 */
export async function saveConfig(config: Partial<SupercheckConfig>): Promise<void> {
  try {
    const existing = await getConfig();
    const merged = { ...existing, ...config };
    await chrome.storage.local.set({ [STORAGE_KEY]: merged });
  } catch (error) {
    console.error('[Supercheck] Failed to save config:', error);
    throw error;
  }
}

/**
 * Replace the stored configuration with `config`, dropping any credential that
 * belonged to a different instance. Used when the options page switches to a
 * new instance URL so an old key is never sent to the new host.
 */
export async function replaceConfig(config: SupercheckConfig): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
  } catch (error) {
    console.error('[Supercheck] Failed to replace config:', error);
    throw error;
  }
}

/**
 * Compare two instance URLs by origin, ignoring trailing slashes and paths.
 */
export function isSameInstance(first?: string, second?: string): boolean {
  if (!first || !second)
    return false;

  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}

/** A saved self-hosted instance is never replaced silently: switching needs the options page. */
export function canAutoConnect(savedInstanceUrl: string, pageOrigin: string): boolean {
  return isSupercheckCloudOrigin(new URL(savedInstanceUrl).origin) || isSameInstance(savedInstanceUrl, pageOrigin);
}

/** Store the credential handed over by a Supercheck page. */
export async function autoConnect(payload: AutoConnectPayload): Promise<void> {
  const { instanceUrl: saved } = await getConfig();
  if (!canAutoConnect(saved, payload.instanceUrl))
    throw new Error(`The recorder is set to ${new URL(saved).origin}. Change the instance in the extension options to connect to another one.`);
  await replaceConfig({ ...payload, autoConnected: true });
}

/** How long to wait for the instance when revoking the key on disconnect. */
const REVOKE_TIMEOUT_MS = 5000;

/**
 * Clear all Supercheck configuration (logout).
 *
 * Local credentials are always removed: the user asked to disconnect, and an
 * unreachable or changed instance must not leave the key stuck in this browser.
 * The held key is revoked on the server first, best-effort. When that fails the
 * caller gets `revoked: false` so it can tell the user to revoke the key from
 * their Supercheck settings.
 */
export async function clearConfig(): Promise<{ revoked: boolean }> {
  let revoked = true;
  try {
    const config = await getConfig();
    if (config.apiKey) {
      try {
        const response = await fetch(`${config.instanceUrl.replace(/\/$/, '')}/api/extension/auth`, {
          method: 'DELETE',
          headers: { 'x-api-key': config.apiKey },
          signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
        });
        // 401 means the key is already invalid, which is the outcome we want.
        revoked = response.ok || response.status === 401;
      } catch (error) {
        console.warn('[Supercheck] Could not reach the instance to revoke the key:', error);
        revoked = false;
      }
    }
    await Promise.all([chrome.storage.local.remove(STORAGE_KEY), chrome.storage.sync.remove(STORAGE_KEY)]);
    return { revoked };
  } catch (error) {
    console.error('[Supercheck] Failed to clear config:', error);
    throw error;
  }
}

/**
 * Check if the extension is configured
 */
export async function isConfigured(): Promise<boolean> {
  const config = await getConfig();
  return !!(config?.instanceUrl && config?.apiKey);
}

/**
 * Get the instance URL (defaults to cloud)
 */
export async function getInstanceUrl(): Promise<string> {
  const config = await getConfig();
  return config?.instanceUrl || DEFAULT_INSTANCE_URL;
}

/**
 * Validate instance URL format
 */
export function validateInstanceUrl(url: string): { valid: boolean; error?: string } {
  if (!url)
    return { valid: false, error: 'Instance URL is required' };


  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol))
      return { valid: false, error: 'URL must use http or https protocol' };

    // Allow localhost for development
    if (parsed.hostname === 'localhost' && parsed.protocol === 'http:')
      return { valid: true };

    // Require HTTPS for production
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost')
      return { valid: false, error: 'Production URLs must use HTTPS' };

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Listen for configuration changes
 */
export function addConfigChangeListener(
  listener: (config: SupercheckConfig | null) => void
): () => void {
  const handler = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (STORAGE_KEY in changes) {
      const value = changes[STORAGE_KEY].newValue;
      listener(isConfig(value) ? value : null);
    }
  };

  chrome.storage.local.onChanged.addListener(handler);

  return () => {
    chrome.storage.local.onChanged.removeListener(handler);
  };
}

export { DEFAULT_INSTANCE_URL };
