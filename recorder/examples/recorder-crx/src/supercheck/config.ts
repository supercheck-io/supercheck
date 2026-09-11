/**
 * Supercheck Recorder - Configuration Management
 *
 * Manages Supercheck instance URL and authentication configuration.
 * Default: supercheck.io (cloud) - works seamlessly without any setup.
 * Self-hosted users can configure via options page.
 */

export interface SupercheckConfig {
  instanceUrl: string;
  apiKey?: string;
  userId?: string;
  userEmail?: string;
  lastProjectId?: string;
  autoConnected?: boolean; // True if connected via seamless auth
}

const STORAGE_KEY = 'supercheckConfig';
const DEFAULT_INSTANCE_URL = 'https://app.supercheck.io';

// Default config - extension works with supercheck.io out of the box
const DEFAULT_CONFIG: SupercheckConfig = {
  instanceUrl: DEFAULT_INSTANCE_URL,
  autoConnected: false,
};

/**
 * Get the current Supercheck configuration
 * Returns default config if none exists (enables seamless operation)
 */
export async function getConfig(): Promise<SupercheckConfig> {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEY);
    return { ...DEFAULT_CONFIG, ...result[STORAGE_KEY] };
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
    await chrome.storage.sync.set({ [STORAGE_KEY]: merged });
  } catch (error) {
    console.error('[Supercheck] Failed to save config:', error);
    throw error;
  }
}

/**
 * Clear all Supercheck configuration (logout)
 */
export async function clearConfig(): Promise<void> {
  try {
    await chrome.storage.sync.remove(STORAGE_KEY);
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
    if (STORAGE_KEY in changes)
      listener(changes[STORAGE_KEY].newValue || null);

  };

  chrome.storage.sync.onChanged.addListener(handler);

  return () => {
    chrome.storage.sync.onChanged.removeListener(handler);
  };
}

export { DEFAULT_INSTANCE_URL };
