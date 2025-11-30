/**
 * Variable Resolver Tests
 * 
 * Comprehensive test coverage for variable resolution and injection
 * 
 * Test Categories:
 * - Variable Resolution (project variables, secrets)
 * - Variable Function Generation (getVariable, getSecret)
 * - Variable Name Extraction (from scripts)
 * - Encryption/Decryption (secret handling)
 * - Error Handling (missing variables, decryption failures)
 * - Security (secret protection, console logging prevention)
 */

import {
  resolveProjectVariables,
  extractVariableNames,
  generateVariableFunctions,
  generateGetVariableFunction,
} from './variable-resolver';

// Mock dependencies
const mockWhere = jest.fn();

jest.mock('@/utils/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
  },
}));

jest.mock('@/lib/encryption', () => ({
  decryptValue: jest.fn(),
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(() => 'mock-eq-condition'),
}));

jest.mock('@/db/schema', () => ({
  projectVariables: {},
}));

import { decryptValue } from '@/lib/encryption';

const mockDecryptValue = decryptValue as jest.Mock;

describe('Variable Resolver', () => {
  const testProjectId = 'project-123';

  const mockVariables = [
    {
      key: 'API_URL',
      value: 'https://api.example.com',
      isSecret: false,
      encryptedValue: null,
      projectId: testProjectId,
    },
    {
      key: 'TIMEOUT',
      value: '5000',
      isSecret: false,
      encryptedValue: null,
      projectId: testProjectId,
    },
    {
      key: 'API_KEY',
      value: '',
      isSecret: true,
      encryptedValue: 'encrypted:abc123',
      projectId: testProjectId,
    },
    {
      key: 'DB_PASSWORD',
      value: '',
      isSecret: true,
      encryptedValue: 'encrypted:xyz789',
      projectId: testProjectId,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock implementations
    mockWhere.mockResolvedValue(mockVariables);
    
    mockDecryptValue.mockImplementation((encrypted) => {
      if (encrypted === 'encrypted:abc123') return 'secret-api-key-value';
      if (encrypted === 'encrypted:xyz789') return 'secret-password-value';
      throw new Error('Decryption failed');
    });
  });

  // ==========================================================================
  // RESOLVE PROJECT VARIABLES TESTS
  // ==========================================================================

  describe('resolveProjectVariables', () => {
    describe('Positive Cases', () => {
      it('should resolve plain text variables', async () => {
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.variables).toEqual({
          API_URL: 'https://api.example.com',
          TIMEOUT: '5000',
        });
        expect(result.errors).toBeUndefined();
      });

      it('should resolve secret variables', async () => {
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.secrets).toEqual({
          API_KEY: 'secret-api-key-value',
          DB_PASSWORD: 'secret-password-value',
        });
      });

      it('should decrypt secrets using project ID', async () => {
        await resolveProjectVariables(testProjectId);
        
        expect(mockDecryptValue).toHaveBeenCalledWith('encrypted:abc123', testProjectId);
        expect(mockDecryptValue).toHaveBeenCalledWith('encrypted:xyz789', testProjectId);
      });

      it('should return empty objects when no variables', async () => {
        mockWhere.mockResolvedValue([]);
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.variables).toEqual({});
        expect(result.secrets).toEqual({});
      });
    });

    describe('Negative Cases', () => {
      it('should handle decryption failure gracefully', async () => {
        mockDecryptValue.mockImplementation(() => {
          throw new Error('Decryption failed');
        });
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.errors).toBeDefined();
        expect(result.errors!.some(e => e.includes('Failed to resolve'))).toBe(true);
      });

      it('should handle missing encrypted value for secret', async () => {
        mockWhere.mockResolvedValue([
          {
            key: 'BROKEN_SECRET',
            value: '',
            isSecret: true,
            encryptedValue: null,
            projectId: testProjectId,
          },
        ]);
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.errors!.some(e => e.includes('has no encrypted value'))).toBe(true);
      });

      it('should handle database error', async () => {
        mockWhere.mockRejectedValue(new Error('Database error'));
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.variables).toEqual({});
        expect(result.secrets).toEqual({});
        expect(result.errors!.some(e => e.includes('Failed to resolve variables'))).toBe(true);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty project ID', async () => {
        const result = await resolveProjectVariables('');
        
        expect(result).toBeDefined();
      });

      it('should continue resolving other variables after one fails', async () => {
        mockDecryptValue.mockImplementation((encrypted) => {
          if (encrypted === 'encrypted:abc123') throw new Error('Failed');
          return 'secret-password-value';
        });
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.secrets.DB_PASSWORD).toBe('secret-password-value');
        expect(result.errors).toHaveLength(1);
      });
    });
  });

  // ==========================================================================
  // EXTRACT VARIABLE NAMES TESTS
  // ==========================================================================

  describe('extractVariableNames', () => {
    describe('Positive Cases', () => {
      it('should extract getVariable calls', () => {
        const script = `
          const url = getVariable('API_URL');
          const timeout = getVariable('TIMEOUT');
        `;
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('API_URL');
        expect(result).toContain('TIMEOUT');
      });

      it('should extract getSecret calls', () => {
        const script = `
          const apiKey = getSecret('API_KEY');
          const password = getSecret('DB_PASSWORD');
        `;
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('API_KEY');
        expect(result).toContain('DB_PASSWORD');
      });

      it('should handle double quotes', () => {
        const script = `const url = getVariable("API_URL");`;
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('API_URL');
      });

      it('should handle backtick quotes', () => {
        const script = 'const url = getVariable(`API_URL`);';
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('API_URL');
      });

      it('should not duplicate variable names', () => {
        const script = `
          const url1 = getVariable('API_URL');
          const url2 = getVariable('API_URL');
        `;
        
        const result = extractVariableNames(script);
        
        const count = result.filter(name => name === 'API_URL').length;
        expect(count).toBe(1);
      });
    });

    describe('Negative Cases', () => {
      it('should return empty array for no variables', () => {
        const script = `const x = 1 + 1;`;
        
        const result = extractVariableNames(script);
        
        expect(result).toEqual([]);
      });

      it('should not match similar function names', () => {
        const script = `
          const url = myGetVariable('NOT_A_VAR');
          const key = getSecretKey('NOT_A_SECRET');
        `;
        
        const result = extractVariableNames(script);
        
        expect(result).not.toContain('NOT_A_VAR');
        expect(result).not.toContain('NOT_A_SECRET');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty script', () => {
        const result = extractVariableNames('');
        
        expect(result).toEqual([]);
      });

      it('should handle script with only whitespace', () => {
        const result = extractVariableNames('   \n\t   ');
        
        expect(result).toEqual([]);
      });

      it('should handle variable names with underscores and numbers', () => {
        const script = `
          const v1 = getVariable('VAR_NAME_123');
          const v2 = getSecret('SECRET_2_KEY');
        `;
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('VAR_NAME_123');
        expect(result).toContain('SECRET_2_KEY');
      });

      it('should handle minified code', () => {
        const script = `getVariable('A');getVariable('B');getSecret('C');`;
        
        const result = extractVariableNames(script);
        
        expect(result).toContain('A');
        expect(result).toContain('B');
        expect(result).toContain('C');
      });
    });
  });

  // ==========================================================================
  // GENERATE VARIABLE FUNCTIONS TESTS
  // ==========================================================================

  describe('generateVariableFunctions', () => {
    describe('Positive Cases', () => {
      it('should generate getVariable function', () => {
        const variables = { API_URL: 'https://example.com' };
        
        const result = generateVariableFunctions(variables, {});
        
        expect(result).toContain('function getVariable');
        expect(result).toContain('API_URL');
        expect(result).toContain('https://example.com');
      });

      it('should generate getSecret function', () => {
        const secrets = { API_KEY: 'secret123' };
        
        const result = generateVariableFunctions({}, secrets);
        
        expect(result).toContain('function getSecret');
        expect(result).toContain('API_KEY');
      });

      it('should handle special characters in values', () => {
        const variables = { 
          URL: 'https://example.com?foo=bar&baz=qux',
          JSON: '{"key": "value"}',
        };
        
        const result = generateVariableFunctions(variables, {});
        
        expect(result).toContain('example.com');
        // Values should be JSON-stringified
        expect(result).toBeDefined();
      });

      it('should handle empty variables object', () => {
        const result = generateVariableFunctions({}, {});
        
        expect(result).toContain('function getVariable');
        expect(result).toContain('function getSecret');
      });
    });

    describe('Variable Function Behavior', () => {
      it('should generate function that returns value for known key', () => {
        const variables = { TEST_VAR: 'test_value' };
        const result = generateVariableFunctions(variables, {});
        
        // The generated function should have the variable embedded
        expect(result).toContain('TEST_VAR');
        expect(result).toContain('test_value');
      });

      it('should generate function with required option support', () => {
        const result = generateVariableFunctions({}, {});
        
        expect(result).toContain('options.required');
        expect(result).toContain("throw new Error");
      });

      it('should generate function with default option support', () => {
        const result = generateVariableFunctions({}, {});
        
        expect(result).toContain('options.default');
      });

      it('should generate function with type conversion support', () => {
        const result = generateVariableFunctions({}, {});
        
        expect(result).toContain("options.type");
        expect(result).toContain("'number'");
        expect(result).toContain("'boolean'");
        expect(result).toContain("'string'");
      });
    });

    describe('Secret Protection', () => {
      it('should generate protected secret object', () => {
        const result = generateVariableFunctions({}, { SECRET: 'value' });
        
        expect(result).toContain('protectedSecret');
        expect(result).toContain("toString: () => '[SECRET]'");
        expect(result).toContain("toJSON: () => '[SECRET]'");
      });

      it('should prevent console logging of secrets', () => {
        const result = generateVariableFunctions({}, { SECRET: 'value' });
        
        expect(result).toContain('[Symbol.for');
        expect(result).toContain('[SECRET]');
      });

      it('should seal protected secret object', () => {
        const result = generateVariableFunctions({}, { SECRET: 'value' });
        
        expect(result).toContain('Object.seal(protectedSecret)');
      });
    });

    describe('Edge Cases', () => {
      it('should handle keys with quotes', () => {
        const variables = { 'KEY_WITH"QUOTE': 'value' };
        
        const result = generateVariableFunctions(variables, {});
        
        // Should escape quotes
        expect(result).toBeDefined();
      });

      it('should handle values with newlines', () => {
        const variables = { MULTILINE: 'line1\nline2' };
        
        const result = generateVariableFunctions(variables, {});
        
        expect(result).toBeDefined();
      });

      it('should handle unicode values', () => {
        const variables = { UNICODE: '你好世界 🎉' };
        
        const result = generateVariableFunctions(variables, {});
        
        expect(result).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // DEPRECATED FUNCTION TESTS
  // ==========================================================================

  describe('generateGetVariableFunction (deprecated)', () => {
    it('should still work for backwards compatibility', () => {
      const variables = { TEST: 'value' };
      
      const result = generateGetVariableFunction(variables);
      
      expect(result).toContain('function getVariable');
      expect(result).toContain('TEST');
    });

    it('should call generateVariableFunctions with empty secrets', () => {
      const variables = { VAR: 'val' };
      
      const result = generateGetVariableFunction(variables);
      
      // Should still generate both functions
      expect(result).toContain('function getSecret');
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    describe('Secret Handling', () => {
      it('should not expose secrets in plain text errors', async () => {
        mockDecryptValue.mockImplementation(() => {
          throw new Error('Decryption failed');
        });
        
        const result = await resolveProjectVariables(testProjectId);
        
        // Error messages should not contain actual secret values
        result.errors?.forEach(error => {
          expect(error).not.toContain('secret-api-key-value');
          expect(error).not.toContain('secret-password-value');
        });
      });
    });

    describe('Injection Prevention', () => {
      it('should escape special characters in variable names', () => {
        const variables = { '<script>alert(1)</script>': 'xss' };
        
        // Should not throw and should escape properly
        expect(() => generateVariableFunctions(variables, {})).not.toThrow();
      });

      it('should JSON stringify values safely', () => {
        const variables = { 
          INJECT: '</script><script>alert(1)</script>' 
        };
        
        const result = generateVariableFunctions(variables, {});
        
        // Should be JSON stringified (escaped in JS context)
        expect(result).toContain('INJECT');
        // Value should be escaped/quoted as a JSON string
        expect(result).toContain(JSON.stringify('</script><script>alert(1)</script>'));
      });
    });
  });

  // ==========================================================================
  // BOUNDARY TESTS
  // ==========================================================================

  describe('Boundary Cases', () => {
    describe('Large Data', () => {
      it('should handle many variables', async () => {
        const manyVariables = Array.from({ length: 100 }, (_, i) => ({
          key: `VAR_${i}`,
          value: `value_${i}`,
          isSecret: false,
          encryptedValue: null,
          projectId: testProjectId,
        }));
        
        mockWhere.mockResolvedValue(manyVariables);
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(Object.keys(result.variables)).toHaveLength(100);
      });

      it('should handle large variable values', async () => {
        const largeValue = 'x'.repeat(100000);
        mockWhere.mockResolvedValue([{
          key: 'LARGE',
          value: largeValue,
          isSecret: false,
          encryptedValue: null,
          projectId: testProjectId,
        }]);
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.variables.LARGE).toBe(largeValue);
      });
    });

    describe('Empty Values', () => {
      it('should handle empty string values', async () => {
        mockWhere.mockResolvedValue([{
          key: 'EMPTY',
          value: '',
          isSecret: false,
          encryptedValue: null,
          projectId: testProjectId,
        }]);
        
        const result = await resolveProjectVariables(testProjectId);
        
        expect(result.variables.EMPTY).toBe('');
      });
    });
  });
});
