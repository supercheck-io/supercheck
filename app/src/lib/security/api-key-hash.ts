/**
 * API Key Hashing Utility
 *
 * Provides secure hashing for API keys before storage.
 * Uses SHA-256 with constant-time comparison for verification.
 *
 * Token Format Specification:
 * - CLI/API tokens: sck_live_{32 hex chars} or sck_test_{32 hex chars}
 * - Trigger keys: sck_trigger_{32 hex chars} (for CI/CD job triggers)
 * - Legacy job keys: job_{32 hex chars} (backward compatible, still fully supported)
 *
 * IMPORTANT: This is a one-way hash - the original key cannot be recovered.
 * The plain key is only shown to the user once during creation.
 */

import crypto from "crypto";

/**
 * Token type prefixes
 *
 * BACKWARD COMPATIBILITY NOTE:
 * The legacy `job_` prefix is fully supported and will continue to work.
 * New keys are generated with `sck_trigger_` prefix, but both are valid.
 */
export const TOKEN_PREFIXES = {
  /** CLI/API token for production */
  CLI_LIVE: "sck_live_",
  /** CLI/API token for testing/development */
  CLI_TEST: "sck_test_",
  /** Trigger key for CI/CD job execution (new format) */
  TRIGGER: "sck_trigger_",
  /** Legacy job trigger key (fully supported for backward compatibility) */
  TRIGGER_LEGACY: "job_",
} as const;

export type TokenType = "cli_live" | "cli_test" | "trigger" | "trigger_legacy" | "unknown";

/**
 * Detect the type of token based on its prefix
 *
 * @param token - The token to analyze
 * @returns The token type
 */
export function getTokenType(token: string): TokenType {
  if (token.startsWith(TOKEN_PREFIXES.CLI_LIVE)) return "cli_live";
  if (token.startsWith(TOKEN_PREFIXES.CLI_TEST)) return "cli_test";
  if (token.startsWith(TOKEN_PREFIXES.TRIGGER)) return "trigger";
  // IMPORTANT: Check legacy prefix AFTER new prefix to avoid false matches
  if (token.startsWith(TOKEN_PREFIXES.TRIGGER_LEGACY)) return "trigger_legacy";
  return "unknown";
}

/**
 * Check if a token is a trigger key (either new or legacy format)
 * Both formats are equally valid and supported.
 *
 * @param token - The token to check
 * @returns True if it's a trigger key (job_ or sck_trigger_ prefix)
 */
export function isTriggerKey(token: string): boolean {
  const type = getTokenType(token);
  return type === "trigger" || type === "trigger_legacy";
}

/**
 * Check if a token is a CLI/API token
 *
 * @param token - The token to check
 * @returns True if it's a CLI/API token
 */
export function isCliToken(token: string): boolean {
  const type = getTokenType(token);
  return type === "cli_live" || type === "cli_test";
}

/**
 * Hash an API key for secure storage using SHA-256.
 *
 * SECURITY NOTE - Why SHA-256 is appropriate here (not bcrypt/argon2):
 * =====================================================================
 * This function hashes HIGH-ENTROPY API keys, NOT user passwords.
 *
 * API keys are generated with crypto.randomBytes(16) = 128 bits of entropy.
 * Even at 1 billion hashes/second, brute-forcing 2^128 possibilities would
 * take approximately 10^22 years - longer than the age of the universe.
 *
 * Password hashing algorithms (bcrypt, argon2) are designed for LOW-entropy
 * user-chosen passwords that are vulnerable to dictionary attacks. Using them
 * here would:
 * - Add 100-500ms latency per API request verification
 * - Provide no additional security benefit for high-entropy keys
 * - Impact performance for high-throughput CI/CD job triggers
 *
 * Industry standard: GitHub, Stripe, AWS all use SHA-256 for API keys.
 *
 * CodeQL flags this as "insufficient computational effort" but that rule
 * (CWE-916) is designed for passwords, not cryptographically random tokens.
 *
 * @param apiKey - The plain text API key to hash (high-entropy, randomly generated)
 * @returns The hex-encoded SHA-256 hash
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
 * @see generateApiKey - generates 128-bit entropy keys
 */
export function hashApiKey(apiKey: string): string {
  // lgtm[js/insufficient-password-hash] - API keys have 128-bit entropy, not passwords
  // codeql[js/insufficient-password-hash] - False positive: high-entropy API keys, not passwords
  return crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/**
 * Verify an API key against its stored hash
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Works with both legacy (job_) and new (sck_trigger_) formats.
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
 * Generate a cryptographically secure trigger API key for job execution
 *
 * New format: sck_trigger_{32 hex characters} = 44 characters total
 * Legacy format: job_{32 hex characters} = 36 characters total (still generated if requested)
 *
 * BACKWARD COMPATIBILITY: Set useLegacyFormat=true to generate legacy job_ keys.
 * Both formats are fully supported by verifyApiKey().
 *
 * @param useLegacyFormat - If true, generates legacy job_ prefix (default: false)
 * @returns A new random API key
 */
export function generateApiKey(useLegacyFormat: boolean = false): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  const prefix = useLegacyFormat ? TOKEN_PREFIXES.TRIGGER_LEGACY : TOKEN_PREFIXES.TRIGGER;
  return `${prefix}${randomPart}`;
}

/**
 * Generate a CLI/API token
 *
 * Format: sck_live_{32 hex characters} or sck_test_{32 hex characters}
 *
 * @param isTest - If true, generates a test token (default: false)
 * @returns A new random CLI token
 */
export function generateCliToken(isTest: boolean = false): string {
  const randomPart = crypto.randomBytes(16).toString("hex");
  const prefix = isTest ? TOKEN_PREFIXES.CLI_TEST : TOKEN_PREFIXES.CLI_LIVE;
  return `${prefix}${randomPart}`;
}

/**
 * Get the display prefix for an API key (for UI display)
 * Shows the prefix plus first few characters of the random part
 *
 * @param apiKey - The full API key
 * @returns The display prefix (e.g., "sck_trigger_a1b2..." or "job_a1b2...")
 */
export function getApiKeyPrefix(apiKey: string): string {
  const type = getTokenType(apiKey);

  switch (type) {
    case "cli_live":
      return apiKey.substring(0, TOKEN_PREFIXES.CLI_LIVE.length + 4) + "...";
    case "cli_test":
      return apiKey.substring(0, TOKEN_PREFIXES.CLI_TEST.length + 4) + "...";
    case "trigger":
      return apiKey.substring(0, TOKEN_PREFIXES.TRIGGER.length + 4) + "...";
    case "trigger_legacy":
      return apiKey.substring(0, TOKEN_PREFIXES.TRIGGER_LEGACY.length + 4) + "...";
    default:
      return apiKey.substring(0, 8) + "...";
  }
}

/**
 * Validate token format
 *
 * Supports both legacy (job_) and new (sck_*) formats.
 *
 * @param token - The token to validate
 * @returns Object with isValid and optional error message
 */
export function validateTokenFormat(token: string): {
  isValid: boolean;
  error?: string;
  type: TokenType;
} {
  if (!token || typeof token !== "string") {
    return { isValid: false, error: "Token is required", type: "unknown" };
  }

  const trimmed = token.trim();
  if (trimmed.length < 10) {
    return {
      isValid: false,
      error: "Token must be at least 10 characters",
      type: "unknown",
    };
  }

  const type = getTokenType(trimmed);

  if (type === "unknown") {
    return {
      isValid: false,
      error: "Invalid token format. Expected prefix: sck_live_, sck_test_, sck_trigger_, or job_",
      type: "unknown",
    };
  }

  // Validate expected length based on type
  const expectedLengths: Record<TokenType, number> = {
    cli_live: TOKEN_PREFIXES.CLI_LIVE.length + 32, // 9 + 32 = 41
    cli_test: TOKEN_PREFIXES.CLI_TEST.length + 32, // 9 + 32 = 41
    trigger: TOKEN_PREFIXES.TRIGGER.length + 32, // 12 + 32 = 44
    trigger_legacy: TOKEN_PREFIXES.TRIGGER_LEGACY.length + 32, // 4 + 32 = 36
    unknown: 0,
  };

  const expectedLength = expectedLengths[type];
  if (trimmed.length !== expectedLength) {
    return {
      isValid: false,
      error: `Invalid token length. Expected ${expectedLength} characters for ${type} token`,
      type,
    };
  }

  return { isValid: true, type };
}
