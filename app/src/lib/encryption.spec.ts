/**
 * Encryption Wrapper Tests
 * Tests for the high-level encryption API
 */

import {
  encryptValue,
  decryptValue,
  generateEncryptionKey,
  validateEncryptionKey,
} from './encryption';

// Mock the crypto module for key generation
const mockRandomValues = jest.fn();

describe('Encryption', () => {
  const testKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeAll(() => {
    process.env.SECRET_ENCRYPTION_KEY = testKey;
  });

  afterAll(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  describe('encryptValue', () => {
    it('should encrypt a value with project context', () => {
      const value = 'my-secret-value';
      const projectId = 'project-123';

      const encrypted = encryptValue(value, projectId);

      expect(encrypted.startsWith('enc:v1:')).toBe(true);
      expect(encrypted).not.toContain(value);
    });

    it('should produce different ciphertext for same value (random IV)', () => {
      const value = 'test-secret';
      const projectId = 'project-456';

      const encrypted1 = encryptValue(value, projectId);
      const encrypted2 = encryptValue(value, projectId);

      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should handle empty values', () => {
      const encrypted = encryptValue('', 'project-123');
      expect(encrypted.startsWith('enc:v1:')).toBe(true);
    });

    it('should handle special characters', () => {
      const value = 'password="secret!@#$%"';
      const encrypted = encryptValue(value, 'project-123');
      const decrypted = decryptValue(encrypted, 'project-123');

      expect(decrypted).toBe(value);
    });

    it('should handle unicode characters', () => {
      const value = '密码: 安全的';
      const encrypted = encryptValue(value, 'project-123');
      const decrypted = decryptValue(encrypted, 'project-123');

      expect(decrypted).toBe(value);
    });
  });

  describe('decryptValue', () => {
    it('should decrypt an encrypted value', () => {
      const value = 'original-secret';
      const projectId = 'project-789';

      const encrypted = encryptValue(value, projectId);
      const decrypted = decryptValue(encrypted, projectId);

      expect(decrypted).toBe(value);
    });

    it('should throw for wrong project context', () => {
      const encrypted = encryptValue('secret', 'project-A');

      expect(() => {
        decryptValue(encrypted, 'project-B');
      }).toThrow();
    });

    it('should throw for unsupported format', () => {
      expect(() => {
        decryptValue('not-encrypted', 'project-123');
      }).toThrow('Unsupported encrypted value format');
    });

    it('should throw for wrong prefix', () => {
      expect(() => {
        decryptValue('enc:v2:somedata', 'project-123');
      }).toThrow('Unsupported encrypted value format');
    });

    it('should throw for tampered data', () => {
      const encrypted = encryptValue('secret', 'project-123');
      const tampered = encrypted.slice(0, -5) + 'XXXXX';

      expect(() => {
        decryptValue(tampered, 'project-123');
      }).toThrow();
    });

    it('should handle long values', () => {
      const value = 'x'.repeat(10000);
      const encrypted = encryptValue(value, 'project-123');
      const decrypted = decryptValue(encrypted, 'project-123');

      expect(decrypted).toBe(value);
    });
  });

  describe('generateEncryptionKey', () => {
    it('should generate a 64-character hex key', () => {
      const key = generateEncryptionKey();
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]+$/);
    });

    it('should generate unique keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 10; i++) {
        keys.add(generateEncryptionKey());
      }
      expect(keys.size).toBe(10);
    });
  });

  describe('validateEncryptionKey', () => {
    it('should return true for valid 64-char hex key', () => {
      const key = '0'.repeat(64);
      expect(validateEncryptionKey(key)).toBe(true);
    });

    it('should return true for valid 32-char key', () => {
      const key = '0'.repeat(32);
      expect(validateEncryptionKey(key)).toBe(true);
    });

    it('should return false for short keys', () => {
      const key = '0'.repeat(16);
      expect(validateEncryptionKey(key)).toBe(false);
    });

    it('should return false for non-string', () => {
      expect(validateEncryptionKey(123 as unknown as string)).toBe(false);
      expect(validateEncryptionKey(null as unknown as string)).toBe(false);
      expect(validateEncryptionKey(undefined as unknown as string)).toBe(false);
    });

    it('should return true for alphanumeric keys >= 32 chars', () => {
      const key = 'abcdefghijklmnopqrstuvwxyz123456';
      expect(validateEncryptionKey(key)).toBe(true);
    });
  });

  describe('Format Compatibility', () => {
    it('should maintain format consistency', () => {
      const value = 'test';
      const encrypted = encryptValue(value, 'project-123');

      // Format should be: enc:v1:<base64-encoded-envelope>
      const parts = encrypted.split(':');
      expect(parts[0]).toBe('enc');
      expect(parts[1]).toBe('v1');
      expect(parts.length).toBe(3);

      // Base64 should be valid
      const payload = parts[2];
      expect(() => {
        JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
      }).not.toThrow();
    });

    it('should include envelope structure', () => {
      const encrypted = encryptValue('test', 'project-123');
      const payload = encrypted.slice('enc:v1:'.length);
      const envelope = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));

      expect(envelope).toHaveProperty('encrypted', true);
      expect(envelope).toHaveProperty('version', 1);
      expect(envelope).toHaveProperty('payload');
    });
  });

  describe('Project Context Isolation', () => {
    it('should isolate secrets by project', () => {
      const secret = 'shared-secret';
      
      const encryptedA = encryptValue(secret, 'project-A');
      const encryptedB = encryptValue(secret, 'project-B');

      // Should decrypt correctly with matching context
      expect(decryptValue(encryptedA, 'project-A')).toBe(secret);
      expect(decryptValue(encryptedB, 'project-B')).toBe(secret);

      // Should fail with wrong context
      expect(() => decryptValue(encryptedA, 'project-B')).toThrow();
      expect(() => decryptValue(encryptedB, 'project-A')).toThrow();
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error for unsupported format', () => {
      expect(() => decryptValue('plain-text', 'project-1'))
        .toThrow('Unsupported encrypted value format');
    });
  });
});
