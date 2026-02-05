/**
 * API Key Hash Utility Tests
 *
 * Tests both new (sck_trigger_) and legacy (job_) token formats
 * to ensure backward compatibility.
 */

import {
  hashApiKey,
  verifyApiKey,
  generateApiKey,
  generateCliToken,
  getApiKeyPrefix,
  getTokenType,
  isTriggerKey,
  isCliToken,
  validateTokenFormat,
  TOKEN_PREFIXES,
} from "@/lib/security/api-key-hash";

describe("API Key Hashing", () => {
  describe("hashApiKey", () => {
    it("should produce consistent hash for same input", () => {
      const key = "job_abc123def456ghi789";
      const hash1 = hashApiKey(key);
      const hash2 = hashApiKey(key);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different inputs", () => {
      const hash1 = hashApiKey("job_abc123");
      const hash2 = hashApiKey("job_def456");
      expect(hash1).not.toBe(hash2);
    });

    it("should produce 64-character hex string (SHA-256)", () => {
      const hash = hashApiKey("test_key");
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe("verifyApiKey", () => {
    it("should return true for matching key and hash (legacy format)", () => {
      const key = "job_test123456789abcdef012345678";
      const hash = hashApiKey(key);
      expect(verifyApiKey(key, hash)).toBe(true);
    });

    it("should return true for matching key and hash (new format)", () => {
      const key = "sck_trigger_test123456789abcdef0123";
      const hash = hashApiKey(key);
      expect(verifyApiKey(key, hash)).toBe(true);
    });

    it("should return false for non-matching key", () => {
      const key1 = "job_test123456789abcdef012345678";
      const key2 = "job_wrong123456789abcdef01234567";
      const hash = hashApiKey(key1);
      expect(verifyApiKey(key2, hash)).toBe(false);
    });

    it("should return false for tampered hash", () => {
      const key = "job_test123456789abcdef012345678";
      const hash = hashApiKey(key);
      const tamperedHash = hash.slice(0, -1) + (hash.slice(-1) === "a" ? "b" : "a");
      expect(verifyApiKey(key, tamperedHash)).toBe(false);
    });

    it("should reject hash with wrong length", () => {
      const key = "job_test123";
      expect(verifyApiKey(key, "short")).toBe(false);
      expect(verifyApiKey(key, "a".repeat(128))).toBe(false);
    });
  });

  describe("generateApiKey", () => {
    it("should generate key with sck_trigger_ prefix by default", () => {
      const key = generateApiKey();
      expect(key.startsWith("sck_trigger_")).toBe(true);
    });

    it("should generate 44-character key (new format)", () => {
      const key = generateApiKey();
      expect(key).toHaveLength(44); // "sck_trigger_" (12) + 32 hex chars
    });

    it("should generate legacy key with job_ prefix when requested", () => {
      const key = generateApiKey(true);
      expect(key.startsWith("job_")).toBe(true);
    });

    it("should generate 36-character key (legacy format)", () => {
      const key = generateApiKey(true);
      expect(key).toHaveLength(36); // "job_" (4) + 32 hex chars
    });

    it("should generate unique keys", () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateApiKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe("generateCliToken", () => {
    it("should generate live token with sck_live_ prefix", () => {
      const token = generateCliToken();
      expect(token.startsWith("sck_live_")).toBe(true);
    });

    it("should generate test token with sck_test_ prefix", () => {
      const token = generateCliToken(true);
      expect(token.startsWith("sck_test_")).toBe(true);
    });

    it("should generate 41-character tokens", () => {
      expect(generateCliToken()).toHaveLength(41);
      expect(generateCliToken(true)).toHaveLength(41);
    });
  });

  describe("getTokenType", () => {
    it("should detect cli_live tokens", () => {
      expect(getTokenType("sck_live_abc123")).toBe("cli_live");
    });

    it("should detect cli_test tokens", () => {
      expect(getTokenType("sck_test_abc123")).toBe("cli_test");
    });

    it("should detect new trigger tokens", () => {
      expect(getTokenType("sck_trigger_abc123")).toBe("trigger");
    });

    it("should detect legacy trigger tokens", () => {
      expect(getTokenType("job_abc123")).toBe("trigger_legacy");
    });

    it("should return unknown for invalid tokens", () => {
      expect(getTokenType("invalid_token")).toBe("unknown");
      expect(getTokenType("")).toBe("unknown");
    });
  });

  describe("isTriggerKey", () => {
    it("should return true for new trigger keys", () => {
      expect(isTriggerKey("sck_trigger_abc123")).toBe(true);
    });

    it("should return true for legacy trigger keys", () => {
      expect(isTriggerKey("job_abc123")).toBe(true);
    });

    it("should return false for CLI tokens", () => {
      expect(isTriggerKey("sck_live_abc123")).toBe(false);
      expect(isTriggerKey("sck_test_abc123")).toBe(false);
    });
  });

  describe("isCliToken", () => {
    it("should return true for CLI tokens", () => {
      expect(isCliToken("sck_live_abc123")).toBe(true);
      expect(isCliToken("sck_test_abc123")).toBe(true);
    });

    it("should return false for trigger keys", () => {
      expect(isCliToken("sck_trigger_abc123")).toBe(false);
      expect(isCliToken("job_abc123")).toBe(false);
    });
  });

  describe("getApiKeyPrefix", () => {
    it("should return prefix for new trigger keys", () => {
      const key = generateApiKey();
      const prefix = getApiKeyPrefix(key);
      expect(prefix).toMatch(/^sck_trigger_[a-f0-9]{4}\.\.\.$/);
    });

    it("should return prefix for legacy keys", () => {
      const key = generateApiKey(true);
      const prefix = getApiKeyPrefix(key);
      expect(prefix).toMatch(/^job_[a-f0-9]{4}\.\.\.$/);
    });

    it("should handle unknown format gracefully", () => {
      const key = "unknown_format_key";
      expect(getApiKeyPrefix(key)).toBe("unknown_...");
    });
  });

  describe("validateTokenFormat", () => {
    it("should validate new trigger tokens", () => {
      const key = generateApiKey();
      const result = validateTokenFormat(key);
      expect(result.isValid).toBe(true);
      expect(result.type).toBe("trigger");
    });

    it("should validate legacy trigger tokens", () => {
      const key = generateApiKey(true);
      const result = validateTokenFormat(key);
      expect(result.isValid).toBe(true);
      expect(result.type).toBe("trigger_legacy");
    });

    it("should validate CLI tokens", () => {
      const liveToken = generateCliToken();
      const testToken = generateCliToken(true);
      
      expect(validateTokenFormat(liveToken).isValid).toBe(true);
      expect(validateTokenFormat(liveToken).type).toBe("cli_live");
      
      expect(validateTokenFormat(testToken).isValid).toBe(true);
      expect(validateTokenFormat(testToken).type).toBe("cli_test");
    });

    it("should reject invalid tokens", () => {
      expect(validateTokenFormat("").isValid).toBe(false);
      expect(validateTokenFormat("short").isValid).toBe(false);
      expect(validateTokenFormat("invalid_prefix_token").isValid).toBe(false);
    });

    it("should reject tokens with wrong length", () => {
      const result = validateTokenFormat("sck_trigger_tooshort");
      expect(result.isValid).toBe(false);
      expect(result.error).toContain("Invalid token length");
    });
  });
});
