/**
 * Retry Utility for External Service Calls
 *
 * Provides robust retry logic with:
 * - Exponential backoff with jitter
 * - Configurable retry limits
 * - Error classification (retryable vs non-retryable)
 * - Timeout handling
 */

import { Logger } from '@nestjs/common';

/**
 * Retry configuration options
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (excluding initial attempt) */
  maxRetries: number;
  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Request timeout in milliseconds */
  timeoutMs: number;
  /** Jitter factor (0-1) to randomize delays (default: 0.1) */
  jitterFactor?: number;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  attempts: number;
  lastStatusCode?: number;
}

/**
 * Default retry configuration for webhook notifications
 */
export const WEBHOOK_RETRY_CONFIG: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  timeoutMs: 10000,
  jitterFactor: 0.1,
};

/**
 * Check if an HTTP status code is retryable
 * Retryable: 429 (rate limit), 5xx (server errors)
 * Not retryable: 4xx (client errors except 429)
 */
export function isRetryableStatusCode(statusCode: number): boolean {
  if (statusCode === 429) return true; // Rate limit - retry with backoff
  if (statusCode >= 500 && statusCode < 600) return true; // Server errors
  return false;
}

/**
 * Check if an error is retryable based on error type
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Retryable network errors
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'econnreset',
      'epipe',
      'enotfound',
      'enetunreach',
      'ehostunreach',
      'etimedout',
      'socket hang up',
      'network',
      'fetch failed',
    ];

    for (const pattern of retryablePatterns) {
      if (message.includes(pattern) || name.includes(pattern)) {
        return true;
      }
    }

    // AbortError from timeout is retryable
    if (name === 'aborterror') {
      return true;
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(attempt: number, options: RetryOptions): number {
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const jitterFactor = options.jitterFactor ?? 0.1;

  // Exponential backoff: initialDelay * multiplier^attempt
  const baseDelay =
    options.initialDelayMs * Math.pow(backoffMultiplier, attempt);

  // Cap at maxDelay
  const cappedDelay = Math.min(baseDelay, options.maxDelayMs);

  // Add jitter: +/- jitterFactor of the delay
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Sleep for a specified duration
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a fetch request with retry logic
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryConfig: RetryOptions,
  logger?: Logger,
): Promise<RetryResult<Response>> {
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        retryConfig.timeoutMs,
      );

      // Merge abort signal with existing options
      const fetchOptions: RequestInit = {
        ...options,
        signal: controller.signal,
      };

      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      lastStatusCode = response.status;

      // Success - return immediately
      if (response.ok) {
        return {
          success: true,
          data: response,
          attempts: attempt + 1,
          lastStatusCode,
        };
      }

      // Check if this status code is retryable
      if (!isRetryableStatusCode(response.status)) {
        const responseText = await response.text().catch(() => '');
        lastError = `HTTP ${response.status}: ${response.statusText}. ${responseText}`;

        // Non-retryable error - return immediately
        logger?.warn(
          `Non-retryable HTTP error (${response.status}), not retrying`,
        );

        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
          lastStatusCode,
        };
      }

      // Retryable status code
      const responseText = await response.text().catch(() => '');
      lastError = `HTTP ${response.status}: ${responseText}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      lastError = errorMessage;

      // Check if error is retryable
      if (!isRetryableError(error)) {
        logger?.warn(`Non-retryable error: ${errorMessage}, not retrying`);

        return {
          success: false,
          error: lastError,
          attempts: attempt + 1,
        };
      }
    }

    // If not the last attempt, wait before retrying
    if (attempt < retryConfig.maxRetries) {
      const delay = calculateDelay(attempt, retryConfig);

      logger?.debug(
        `Retry attempt ${attempt + 1}/${retryConfig.maxRetries} in ${delay}ms. Error: ${lastError}`,
      );

      await sleep(delay);
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: `Failed after ${retryConfig.maxRetries + 1} attempts. Last error: ${lastError}`,
    attempts: retryConfig.maxRetries + 1,
    lastStatusCode,
  };
}

/**
 * Helper to create retry config from environment or defaults
 */
export function createRetryConfig(
  overrides?: Partial<RetryOptions>,
): RetryOptions {
  const envMaxRetries = process.env.NOTIFICATION_MAX_RETRIES;
  const envInitialDelay = process.env.NOTIFICATION_INITIAL_DELAY_MS;
  const envTimeout = process.env.NOTIFICATION_TIMEOUT_MS;

  return {
    maxRetries:
      overrides?.maxRetries ??
      (envMaxRetries
        ? parseInt(envMaxRetries, 10)
        : WEBHOOK_RETRY_CONFIG.maxRetries),
    initialDelayMs:
      overrides?.initialDelayMs ??
      (envInitialDelay
        ? parseInt(envInitialDelay, 10)
        : WEBHOOK_RETRY_CONFIG.initialDelayMs),
    maxDelayMs: overrides?.maxDelayMs ?? WEBHOOK_RETRY_CONFIG.maxDelayMs,
    backoffMultiplier:
      overrides?.backoffMultiplier ?? WEBHOOK_RETRY_CONFIG.backoffMultiplier,
    timeoutMs:
      overrides?.timeoutMs ??
      (envTimeout ? parseInt(envTimeout, 10) : WEBHOOK_RETRY_CONFIG.timeoutMs),
    jitterFactor: overrides?.jitterFactor ?? WEBHOOK_RETRY_CONFIG.jitterFactor,
  };
}

/**
 * Execute any async function with retry logic
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @param logger - Optional logger for debug output
 * @returns The result of the function if successful
 * @throws The last error if all retries fail
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
  logger?: Logger,
): Promise<T> {
  const config = createRetryConfig(options);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Execute with timeout if specified
      if (config.timeoutMs > 0) {
        const result = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => {
            setTimeout(
              () =>
                reject(
                  new Error(`Operation timed out after ${config.timeoutMs}ms`),
                ),
              config.timeoutMs,
            );
          }),
        ]);
        return result;
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (!isRetryableError(error)) {
        logger?.warn(`Non-retryable error: ${lastError.message}, not retrying`);
        throw lastError;
      }

      // If not the last attempt, wait before retrying
      if (attempt < config.maxRetries) {
        const delay = calculateDelay(attempt, config);

        logger?.debug?.(
          `Retry attempt ${attempt + 1}/${config.maxRetries} in ${delay}ms. Error: ${lastError.message}`,
        );

        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  throw (
    lastError ?? new Error(`Failed after ${config.maxRetries + 1} attempts`)
  );
}
