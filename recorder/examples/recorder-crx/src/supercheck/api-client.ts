/**
 * Supercheck Recorder - API Client
 *
 * Handles all communication with the Supercheck API.
 * Implements retry logic with exponential backoff for reliability.
 */

import { getConfig, type SupercheckConfig } from './config';

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export function isRetryableRequestMethod(method = 'GET'): boolean {
  return RETRYABLE_METHODS.has(method.toUpperCase());
}

export interface Project {
  id: string;
  name: string;
  organizationId: string | null;
  organizationName?: string;
}

export interface RecordingMetadata {
  recordedAt: string;
  duration: number;
  stepsCount: number;
  baseUrl: string;
  browserInfo?: string;
  extensionVersion: string;
}

export interface SaveRecordingRequest {
  projectId: string;
  name: string;
  script: string;
  metadata: RecordingMetadata;
}

export interface SaveRecordingResponse {
  testId: string;
  redirectUrl: string;
}

export interface UserInfo {
  id: string;
  email: string;
  name?: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

class SupercheckApiClient {
  private configCache: SupercheckConfig | null = null;

  /**
   * Clear cached configuration (call after logout)
   */
  clearCache(): void {
    this.configCache = null;
  }

  /**
   * Get authentication headers for API requests
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const config = await this.getCachedConfig();

    if (!config?.apiKey)
      throw new AuthError('API key not configured. Please connect to Supercheck first.');


    return {
      'X-API-Key': config.apiKey,
      'X-Extension-Version': chrome.runtime.getManifest().version,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get cached or fresh configuration
   */
  private async getCachedConfig(): Promise<SupercheckConfig | null> {
    if (!this.configCache)
      this.configCache = await getConfig();

    return this.configCache;
  }

  /**
   * Make an authenticated API request with retry logic
   */
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const config = await this.getCachedConfig();
    if (!config?.instanceUrl)
      throw new AuthError('Supercheck instance not configured');


    const authHeaders = await this.getAuthHeaders();
    const url = `${config.instanceUrl}${path}`;

    const response = await this.requestWithRetry(url, {
      ...options,
      headers: {
        ...options.headers,
        ...authHeaders,
      },
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      if (response.status === 401) {
        this.clearCache();
        throw new AuthError('Invalid or expired API key. Please reconnect to Supercheck.');
      }
      if (response.status === 403)
        throw new AuthError('Insufficient permissions for this action.');

      if (response.status === 402)
        throw new ApiError(402, 'Subscription required to use this feature.');


      throw new ApiError(
          response.status,
          errorBody.message || errorBody.error || 'Request failed',
          errorBody.details
      );
    }

    return response.json();
  }

  /**
   * Request with exponential backoff retry
   */
  private async requestWithRetry(
    url: string,
    options: RequestInit,
    attempt = 1
  ): Promise<Response> {
    const canRetry = isRetryableRequestMethod(options.method);

    try {
      const response = await fetch(url, options);

      // Retrying non-idempotent requests can duplicate a mutation when the
      // server handled the request but its response was lost.
      if (canRetry && response.status >= 500 && attempt < MAX_RETRIES) {
        console.warn(`[Supercheck] Request failed (${response.status}), retrying... (attempt ${attempt})`);
        await this.delay(RETRY_DELAY_BASE * Math.pow(2, attempt - 1));
        return this.requestWithRetry(url, options, attempt + 1);
      }

      return response;
    } catch (error) {
      // Retry network errors only when repeating the method is safe.
      if (canRetry && attempt < MAX_RETRIES) {
        console.warn(`[Supercheck] Network error, retrying... (attempt ${attempt})`, error);
        await this.delay(RETRY_DELAY_BASE * Math.pow(2, attempt - 1));
        return this.requestWithRetry(url, options, attempt + 1);
      }
      throw error;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // API Methods
  // ============================================

  /**
   * Verify API key and get user information
   */
  async verifyConnection(): Promise<{ valid: boolean; user?: UserInfo }> {
    try {
      const response = await this.request<{ success: boolean; data: UserInfo }>('/api/auth/me');
      return { valid: true, user: response.data };
    } catch (error) {
      if (error instanceof AuthError)
        return { valid: false };

      throw error;
    }
  }

  /**
   * Get list of user's projects
   */
  async getProjects(): Promise<Project[]> {
    const response = await this.request<{ success: boolean; data: Project[] }>('/api/projects');
    return response.data;
  }

  /**
   * Save a recording as a test
   */
  async saveRecording(request: SaveRecordingRequest): Promise<SaveRecordingResponse> {
    const response = await this.request<{ success: boolean; data: SaveRecordingResponse }>(
        '/api/recordings',
        {
          method: 'POST',
          body: JSON.stringify(request),
        }
    );
    return response.data;
  }

  /**
   * Generate an API key for the extension (called from Supercheck app)
   */
  async generateExtensionApiKey(instanceUrl: string, sessionToken: string): Promise<{ apiKey: string; user: UserInfo }> {
    const response = await fetch(`${instanceUrl}/api/extension/auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        name: 'Supercheck Recorder Extension',
        extensionVersion: chrome.runtime.getManifest().version,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.message || 'Failed to generate API key');
    }

    const data = await response.json();
    return data.data;
  }
}

// Singleton instance
export const apiClient = new SupercheckApiClient();
