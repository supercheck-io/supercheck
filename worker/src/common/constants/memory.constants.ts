/**
 * Memory and resource limit constants
 * Used for resource management and preventing memory leaks
 */

export const MEMORY_LIMITS = {
  // Buffer and data size limits (in bytes)
  MAX_BUFFER_BYTES: 10 * 1024 * 1024, // 10 MB
  MAX_LOG_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_RESPONSE_BODY_BYTES: 10 * 1024 * 1024, // 10 MB

  // Memory thresholds (in MB)
  MEMORY_THRESHOLD_MB: 2048, // 2 GB
  MEMORY_WARNING_THRESHOLD_MB: 1536, // 1.5 GB
  MAX_MEMORY_PER_REQUEST_MB: 50,

  // Response size limits
  MAX_RESPONSE_SIZE_MB: 10,
  MAX_SANITIZED_RESPONSE_LENGTH: 10000,
  RESPONSE_BODY_SNIPPET_LENGTH: 1000,

  // Execution limits
  MAX_CONCURRENT_EXECUTIONS: 1,
  MAX_CONCURRENT_BROWSER_CONTEXTS: 5,
} as const;

export const MEMORY_LIMITS_BYTES = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
} as const;

/**
 * Calculate bytes from megabytes
 */
export function mbToBytes(mb: number): number {
  return mb * MEMORY_LIMITS_BYTES.MB;
}

/**
 * Calculate megabytes from bytes
 */
export function bytesToMb(bytes: number): number {
  return bytes / MEMORY_LIMITS_BYTES.MB;
}
