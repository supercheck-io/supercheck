/**
 * API Key Hashing Utility
 * 
 * Provides secure hashing for API keys before storage.
 * Uses SHA-256 with constant-time comparison for verification.
 * 
 * IMPORTANT: This is a one-way hash - the original key cannot be recovered.
 * The plain key is only shown to the user once during creation.
 */

import crypto from "crypto";

/**
 * Hash an API key for secure storage
 * Uses SHA-256 which is fast enough for API key verification
 * while being computationally infeasible to reverse.
 * 
 * @param apiKey - The plain text API key to hash
 * @returns The hex-encoded hash
 */
export function hashApiKey(apiKey: string): string {
  return crypto
    .createHash("sha256")
    .update(apiKey, "utf8")
    .digest("hex");
}

/**
 * Verify an API key against its stored hash
 * Uses constant-time comparison to prevent timing attacks.
 * 
 * @param apiKey - The plain text API key to verify
 * @param storedHash - The stored hash to compare against
 * @returns True if the key matches the hash
 */
export function verifyApiKey(apiKey: string, storedHash: string): boolean {
  const inputHash = hashApiKey(apiKey);
  
  // Use constant-time comparison to prevent timing attacks
  if (inputHash.length !== storedHash.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(inputHash, "utf8"),
    Buffer.from(storedHash, "utf8")
  );
}

/**
 * Generate a cryptographically secure API key
 * Format: job_{32 hex characters} = 36 characters total
 * 
 * @returns A new random API key
 */
export function generateApiKey(): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  return `job_${randomPart}`;
}

/**
 * Get the display prefix for an API key (for UI display)
 * Shows only the first 8 characters
 * 
 * @param apiKey - The full API key
 * @returns The display prefix
 */
export function getApiKeyPrefix(apiKey: string): string {
  return apiKey.substring(0, 8);
}
