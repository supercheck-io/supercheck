/**
 * Secret Crypto Tests
 * Tests for AES-128-GCM encryption with HKDF key derivation
 */

import {
  encryptSecret,
  decryptSecret,
  encryptJson,
  decryptJson,
  isSecretEnvelope,
  maskSecret,
  type SecretEnvelope,
} from "./secret-crypto";

describe("Secret Crypto", () => {
  const testKey = "0123456789abcdef0123456789abcdef"; // 32 chars hex (16 bytes)

  beforeAll(() => {
    // Set up encryption key for tests
    process.env.SECRET_ENCRYPTION_KEY = testKey + testKey; // 64 chars = 32 bytes hex
  });

  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  describe("encryptSecret", () => {
    it("should encrypt a simple string", () => {
      const plaintext = "my secret value";
      const envelope = encryptSecret(plaintext);

      expect(envelope.encrypted).toBe(true);
      expect(envelope.version).toBe(1);
      expect(typeof envelope.payload).toBe("string");
      expect(envelope.payload).not.toBe(plaintext);
    });

    it("should produce different ciphertext for same plaintext (random IV)", () => {
      const plaintext = "test secret";
      const envelope1 = encryptSecret(plaintext);
      const envelope2 = encryptSecret(plaintext);

      expect(envelope1.payload).not.toBe(envelope2.payload);
    });

    it("should include context when provided", () => {
      const plaintext = "secret with context";
      const envelope = encryptSecret(plaintext, { context: "project-123" });

      expect(envelope.context).toBe("project-123");
    });

    it("should handle empty string", () => {
      const envelope = encryptSecret("");
      expect(envelope.encrypted).toBe(true);
    });

    it("should handle unicode characters", () => {
      const plaintext = "secret: 你好世界 🔐";
      const envelope = encryptSecret(plaintext);
      const decrypted = decryptSecret(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle long strings", () => {
      const plaintext = "a".repeat(10000);
      const envelope = encryptSecret(plaintext);
      const decrypted = decryptSecret(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters", () => {
      const plaintext = "!@#$%^&*()_+-=[]{}|;:'\"<>,.?/\\`~";
      const envelope = encryptSecret(plaintext);
      const decrypted = decryptSecret(envelope);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("decryptSecret", () => {
    it("should decrypt an encrypted value", () => {
      const plaintext = "my secret";
      const envelope = encryptSecret(plaintext);
      const decrypted = decryptSecret(envelope);

      expect(decrypted).toBe(plaintext);
    });

    it("should decrypt with matching context", () => {
      const plaintext = "context-aware secret";
      const context = "project-456";
      const envelope = encryptSecret(plaintext, { context });
      const decrypted = decryptSecret(envelope, { context });

      expect(decrypted).toBe(plaintext);
    });

    it("should fail with wrong context", () => {
      const plaintext = "secret";
      const envelope = encryptSecret(plaintext, { context: "project-A" });

      expect(() => {
        decryptSecret(envelope, { context: "project-B" });
      }).toThrow();
    });

    it("should use envelope context if not provided in options", () => {
      const plaintext = "auto context";
      const context = "project-789";
      const envelope = encryptSecret(plaintext, { context });

      // Decrypt without explicitly passing context - should use envelope.context
      const decrypted = decryptSecret(envelope);
      expect(decrypted).toBe(plaintext);
    });

    it("should throw for invalid envelope", () => {
      expect(() => {
        decryptSecret({ encrypted: false } as unknown as SecretEnvelope);
      }).toThrow("Invalid encrypted envelope");
    });

    it("should throw for tampered ciphertext", () => {
      const envelope = encryptSecret("secret");
      // Tamper with the payload
      const tamperedPayload = Buffer.from(envelope.payload, "base64");
      tamperedPayload[10] = tamperedPayload[10] ^ 0xff;
      envelope.payload = tamperedPayload.toString("base64");

      expect(() => {
        decryptSecret(envelope);
      }).toThrow();
    });

    it("should throw for tampered auth tag", () => {
      const envelope = encryptSecret("secret");
      // Decode, tamper, re-encode
      const decoded = JSON.parse(
        Buffer.from(envelope.payload, "base64").toString()
      );
      const tagBytes = Buffer.from(decoded.tag, "base64");
      tagBytes[0] = tagBytes[0] ^ 0xff;
      decoded.tag = tagBytes.toString("base64");
      envelope.payload = Buffer.from(JSON.stringify(decoded)).toString(
        "base64"
      );

      expect(() => {
        decryptSecret(envelope);
      }).toThrow();
    });
  });

  describe("encryptJson", () => {
    it("should encrypt a JSON object", () => {
      const data = { username: "test", password: "secret123" };
      const envelope = encryptJson(data);

      expect(envelope.encrypted).toBe(true);
      expect(envelope.version).toBe(1);
    });

    it("should encrypt arrays", () => {
      const data = ["secret1", "secret2", "secret3"];
      const envelope = encryptJson(data);
      const decrypted = decryptJson<string[]>(envelope);

      expect(decrypted).toEqual(data);
    });

    it("should encrypt nested objects", () => {
      const data = {
        credentials: {
          api: { key: "abc123", secret: "xyz789" },
          database: { user: "admin", pass: "password" },
        },
      };
      const envelope = encryptJson(data);
      const decrypted = decryptJson<typeof data>(envelope);

      expect(decrypted).toEqual(data);
    });

    it("should handle null values in objects", () => {
      const data = { value: null, other: "test" };
      const envelope = encryptJson(data);
      const decrypted = decryptJson<typeof data>(envelope);

      expect(decrypted).toEqual(data);
    });
  });

  describe("decryptJson", () => {
    it("should decrypt to original object", () => {
      const data = { key: "value", number: 42 };
      const envelope = encryptJson(data);
      const decrypted = decryptJson<typeof data>(envelope);

      expect(decrypted).toEqual(data);
    });

    it("should preserve data types", () => {
      const data = {
        string: "text",
        number: 123.45,
        boolean: true,
        array: [1, 2, 3],
        nested: { a: "b" },
      };
      const envelope = encryptJson(data);
      const decrypted = decryptJson<typeof data>(envelope);

      expect(typeof decrypted.string).toBe("string");
      expect(typeof decrypted.number).toBe("number");
      expect(typeof decrypted.boolean).toBe("boolean");
      expect(Array.isArray(decrypted.array)).toBe(true);
      expect(typeof decrypted.nested).toBe("object");
    });
  });

  describe("isSecretEnvelope", () => {
    it("should return true for valid envelope", () => {
      const envelope = encryptSecret("test");
      expect(isSecretEnvelope(envelope)).toBe(true);
    });

    it("should return false for plain object", () => {
      expect(isSecretEnvelope({ foo: "bar" })).toBe(false);
    });

    it("should return false for null", () => {
      expect(isSecretEnvelope(null)).toBe(false);
    });

    it("should return false for undefined", () => {
      expect(isSecretEnvelope(undefined)).toBe(false);
    });

    it("should return false for string", () => {
      expect(isSecretEnvelope("encrypted")).toBe(false);
    });

    it("should return false for number", () => {
      expect(isSecretEnvelope(123)).toBe(false);
    });

    it("should return false for partial envelope (missing payload)", () => {
      expect(isSecretEnvelope({ encrypted: true, version: 1 })).toBe(false);
    });

    it("should return false for wrong version", () => {
      expect(
        isSecretEnvelope({ encrypted: true, version: 2, payload: "test" })
      ).toBe(false);
    });

    it("should return false for encrypted=false", () => {
      expect(
        isSecretEnvelope({ encrypted: false, version: 1, payload: "test" })
      ).toBe(false);
    });
  });

  describe("maskSecret", () => {
    it("should mask middle of string", () => {
      expect(maskSecret("secretpassword")).toBe("se**********rd");
    });

    it("should handle short strings", () => {
      // Implementation has minimum 3 stars for security
      expect(maskSecret("ab")).toBe("***");
    });

    it("should handle very short strings", () => {
      expect(maskSecret("a")).toBe("***");
    });

    it("should handle empty string", () => {
      expect(maskSecret("")).toBe("***");
    });

    it("should respect visible character count", () => {
      expect(maskSecret("abcdefghij", 6)).toBe("abc****hij");
    });

    it("should handle when visible >= length", () => {
      expect(maskSecret("short", 10)).toBe("*****");
    });

    it("should handle API key format", () => {
      const apiKey = "sk_live_abc123def456ghi789";
      const masked = maskSecret(apiKey, 8);
      expect(masked.startsWith("sk_l")).toBe(true);
      expect(masked.endsWith("i789")).toBe(true);
      expect(masked).toContain("*");
    });
  });

  describe("Key Derivation", () => {
    it("should derive different keys for different contexts", () => {
      const plaintext = "same secret";
      const envelope1 = encryptSecret(plaintext, { context: "context-A" });
      encryptSecret(plaintext, { context: "context-B" });

      // Different contexts should produce different derived keys
      // We can't directly test the key, but we can verify that
      // decrypting with wrong context fails
      expect(() => {
        decryptSecret(envelope1, { context: "context-B" });
      }).toThrow();
    });

    it("should work without context", () => {
      const plaintext = "no context secret";
      const envelope = encryptSecret(plaintext);
      const decrypted = decryptSecret(envelope);

      expect(decrypted).toBe(plaintext);
      expect(envelope.context).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should throw if encryption key is not set", () => {
      const originalKey = process.env.SECRET_ENCRYPTION_KEY;
      delete process.env.SECRET_ENCRYPTION_KEY;

      expect(() => {
        encryptSecret("test");
      }).toThrow("SECRET_ENCRYPTION_KEY environment variable is not set");

      process.env.SECRET_ENCRYPTION_KEY = originalKey;
    });

    it("should throw if encryption key is too short", () => {
      const originalKey = process.env.SECRET_ENCRYPTION_KEY;
      process.env.SECRET_ENCRYPTION_KEY = "short";

      expect(() => {
        encryptSecret("test");
      }).toThrow("at least");

      process.env.SECRET_ENCRYPTION_KEY = originalKey;
    });

    it("should handle malformed payload gracefully", () => {
      const envelope: SecretEnvelope = {
        encrypted: true,
        version: 1,
        payload: "invalid-base64!!!",
      };

      expect(() => {
        decryptSecret(envelope);
      }).toThrow();
    });

    it("should handle corrupted JSON in payload", () => {
      const envelope: SecretEnvelope = {
        encrypted: true,
        version: 1,
        payload: Buffer.from("not valid json").toString("base64"),
      };

      expect(() => {
        decryptSecret(envelope);
      }).toThrow();
    });
  });

  describe("Security Properties", () => {
    it("should use authenticated encryption (tampering detected)", () => {
      const envelope = encryptSecret("sensitive data");

      // Decode the raw envelope
      const decoded = JSON.parse(
        Buffer.from(envelope.payload, "base64").toString()
      );

      // Tamper with the encrypted data
      const dataBytes = Buffer.from(decoded.data, "base64");
      dataBytes[0] = dataBytes[0] ^ 0xff; // Flip bits
      decoded.data = dataBytes.toString("base64");

      envelope.payload = Buffer.from(JSON.stringify(decoded)).toString(
        "base64"
      );

      // Authentication should fail
      expect(() => {
        decryptSecret(envelope);
      }).toThrow();
    });

    it("should not leak plaintext in envelope", () => {
      const sensitive = "API_KEY=super_secret_12345";
      const envelope = encryptSecret(sensitive);

      const serialized = JSON.stringify(envelope);
      expect(serialized).not.toContain("super_secret");
      expect(serialized).not.toContain("API_KEY");
    });

    it("should use unique IV for each encryption", () => {
      const plaintext = "test";
      const envelopes: SecretEnvelope[] = [];

      for (let i = 0; i < 10; i++) {
        envelopes.push(encryptSecret(plaintext));
      }

      // Extract IVs
      const ivs = envelopes.map((e) => {
        const decoded = JSON.parse(Buffer.from(e.payload, "base64").toString());
        return decoded.iv;
      });

      // All IVs should be unique
      const uniqueIvs = new Set(ivs);
      expect(uniqueIvs.size).toBe(10);
    });
  });
});
