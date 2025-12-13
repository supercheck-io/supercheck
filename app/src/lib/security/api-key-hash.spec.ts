/**
 * API Key Hash Utility Tests
 */

import { hashApiKey, verifyApiKey, generateApiKey, getApiKeyPrefix } from "@/lib/security/api-key-hash";

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
    it("should return true for matching key and hash", () => {
      const key = "job_test123456789";
      const hash = hashApiKey(key);
      expect(verifyApiKey(key, hash)).toBe(true);
    });

    it("should return false for non-matching key", () => {
      const key1 = "job_test123456789";
      const key2 = "job_wrong123456789";
      const hash = hashApiKey(key1);
      expect(verifyApiKey(key2, hash)).toBe(false);
    });

    it("should return false for tampered hash", () => {
      const key = "job_test123456789";
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
    it("should generate key with job_ prefix", () => {
      const key = generateApiKey();
      expect(key.startsWith("job_")).toBe(true);
    });

    it("should generate 36-character key", () => {
      const key = generateApiKey();
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

  describe("getApiKeyPrefix", () => {
    it("should return first 8 characters", () => {
      const key = "job_abc123def456ghi789";
      expect(getApiKeyPrefix(key)).toBe("job_abc1");
    });

    it("should handle short keys", () => {
      const key = "short";
      expect(getApiKeyPrefix(key)).toBe("short");
    });
  });
});
