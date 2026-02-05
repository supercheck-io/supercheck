import {
  maskCredentials,
  sanitizeResponseBody,
  sanitizeHeaders,
  getErrorMessage,
  sanitizeLogData,
} from './data-sanitizer';

describe('DataSanitizer', () => {
  describe('maskCredentials', () => {
    // Tests credential masking for secure logging - prevents credential leakage

    it('should mask credentials longer than 4 characters', () => {
      // Standard credential masking showing first/last 2 chars
      const result = maskCredentials('secretpassword');
      expect(result).toBe('se**********rd');
    });

    it('should return *** for very short credentials', () => {
      // Short credentials should be fully masked
      expect(maskCredentials('abc')).toBe('***');
      expect(maskCredentials('ab')).toBe('***');
      expect(maskCredentials('a')).toBe('***');
    });

    it('should return *** for exactly 4 character credentials', () => {
      // 4-char credentials should be fully masked
      expect(maskCredentials('abcd')).toBe('***');
    });

    it('should return *** for empty string', () => {
      expect(maskCredentials('')).toBe('***');
    });

    it('should handle 5 character credentials correctly', () => {
      // Edge case: 5 chars should show first 2, mask 1, show last 2
      const result = maskCredentials('12345');
      expect(result).toBe('12*45');
    });

    it('should handle long API keys', () => {
      // API keys are typically long
      const apiKey = 'sk-abcdefghijklmnopqrstuvwxyz123456';
      const result = maskCredentials(apiKey);
      expect(result).toMatch(/^sk.*56$/);
      expect(result).toContain('*');
    });
  });

  describe('sanitizeResponseBody', () => {
    // Tests response body sanitization - critical for preventing PII leakage

    it('should return empty string for null/undefined input', () => {
      expect(sanitizeResponseBody(null as unknown as string)).toBe('');
      expect(sanitizeResponseBody(undefined as unknown as string)).toBe('');
      expect(sanitizeResponseBody('')).toBe('');
    });

    it('should redact credit card numbers with spaces', () => {
      // PCI DSS compliance: credit cards must be redacted
      const body = 'Payment card: 4111 1111 1111 1111 was charged';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[CARD-REDACTED]');
      expect(result).not.toContain('4111');
    });

    it('should redact credit card numbers with dashes', () => {
      const body = 'Card number: 4111-1111-1111-1111';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[CARD-REDACTED]');
    });

    it('should redact credit card numbers without separators', () => {
      const body = 'Card: 4111111111111111';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[CARD-REDACTED]');
    });

    it('should redact Social Security Numbers with dashes', () => {
      // SSN is highly sensitive PII
      const body = 'SSN: 123-45-6789';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[SSN-REDACTED]');
      expect(result).not.toContain('123-45-6789');
    });

    it('should redact Social Security Numbers without dashes', () => {
      const body = 'SSN: 123456789';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[SSN-REDACTED]');
    });

    it('should redact email addresses', () => {
      // Email addresses are PII
      const body = 'Contact: user@example.com for support';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[EMAIL-REDACTED]');
      expect(result).not.toContain('user@example.com');
    });

    it('should redact multiple email addresses', () => {
      const body = 'From: alice@test.com, To: bob@test.com';
      const result = sanitizeResponseBody(body);
      expect(result.match(/\[EMAIL-REDACTED\]/g)?.length).toBe(2);
    });

    it('should redact long alphanumeric strings that look like API keys', () => {
      // Long random strings are likely API keys
      const body = 'API key: abcdefghijklmnopqrstuvwxyz123456';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[API-KEY-REDACTED]');
    });

    it('should not redact short alphanumeric strings', () => {
      // Short strings are probably not API keys
      const body = 'ID: abc123';
      const result = sanitizeResponseBody(body);
      expect(result).not.toContain('[API-KEY-REDACTED]');
      expect(result).toContain('abc123');
    });

    it('should redact Bearer tokens', () => {
      // Bearer tokens in responses should be masked
      // Note: Long alphanumeric tokens may be caught by API key pattern first
      const body = 'Authorization: Bearer short-token';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[TOKEN-REDACTED]');
    });

    it('should redact Basic auth credentials', () => {
      // Basic auth credentials must be masked
      const body = 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=';
      const result = sanitizeResponseBody(body);
      expect(result).toContain('Basic [CREDENTIALS-REDACTED]');
    });

    it('should truncate very long responses', () => {
      // Prevent memory issues with large responses
      // Note: Long alphanumeric strings may be detected as API keys first
      const longBody = 'Hello world! '.repeat(10000);
      const result = sanitizeResponseBody(longBody);
      expect(result.length).toBeLessThan(longBody.length);
      expect(result).toContain('[TRUNCATED]');
    });

    it('should respect custom max length', () => {
      const body = 'Hello world! '.repeat(100);
      const result = sanitizeResponseBody(body, 100);
      expect(result.length).toBeLessThanOrEqual(120); // 100 + truncation message
      expect(result).toContain('[TRUNCATED]');
    });

    it('should handle mixed sensitive data', () => {
      // Real-world responses may contain multiple types of sensitive data
      const body = `
        User: user@test.com
        Card: 4111-1111-1111-1111
        SSN: 123-45-6789
        Token: Bearer abc123def456ghi789
      `;
      const result = sanitizeResponseBody(body);
      expect(result).toContain('[EMAIL-REDACTED]');
      expect(result).toContain('[CARD-REDACTED]');
      expect(result).toContain('[SSN-REDACTED]');
      expect(result).toContain('[TOKEN-REDACTED]');
    });
  });

  describe('sanitizeHeaders', () => {
    // Tests header sanitization for logging - prevents credential exposure in logs

    it('should redact authorization header', () => {
      const headers = { Authorization: 'Bearer token123' };
      const result = sanitizeHeaders(headers);
      expect(result.Authorization).toBe('[REDACTED]');
    });

    it('should redact cookie header', () => {
      const headers = { Cookie: 'session=abc123; user=john' };
      const result = sanitizeHeaders(headers);
      expect(result.Cookie).toBe('[REDACTED]');
    });

    it('should redact set-cookie header', () => {
      const headers = { 'Set-Cookie': 'session=abc123; HttpOnly' };
      const result = sanitizeHeaders(headers);
      expect(result['Set-Cookie']).toBe('[REDACTED]');
    });

    it('should redact x-api-key header', () => {
      const headers = { 'X-API-Key': 'secret-api-key' };
      const result = sanitizeHeaders(headers);
      expect(result['X-API-Key']).toBe('[REDACTED]');
    });

    it('should redact api-key header', () => {
      const headers = { 'API-Key': 'secret-api-key' };
      const result = sanitizeHeaders(headers);
      expect(result['API-Key']).toBe('[REDACTED]');
    });

    it('should redact x-auth-token header', () => {
      const headers = { 'X-Auth-Token': 'auth-token-123' };
      const result = sanitizeHeaders(headers);
      expect(result['X-Auth-Token']).toBe('[REDACTED]');
    });

    it('should preserve non-sensitive headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': '1234',
        'User-Agent': 'Mozilla/5.0',
      };
      const result = sanitizeHeaders(headers);
      expect(result['Content-Type']).toBe('application/json');
      expect(result['Content-Length']).toBe('1234');
      expect(result['User-Agent']).toBe('Mozilla/5.0');
    });

    it('should handle mixed sensitive and non-sensitive headers', () => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
        Cookie: 'session=123',
        Accept: 'application/json',
      };
      const result = sanitizeHeaders(headers);
      expect(result['Content-Type']).toBe('application/json');
      expect(result.Authorization).toBe('[REDACTED]');
      expect(result.Cookie).toBe('[REDACTED]');
      expect(result.Accept).toBe('application/json');
    });

    it('should handle case-insensitive header matching', () => {
      // Header names may have different casing
      const headers = {
        AUTHORIZATION: 'Bearer token',
        cookie: 'session=123',
      };
      const result = sanitizeHeaders(headers);
      expect(result['AUTHORIZATION']).toBe('[REDACTED]');
      expect(result['cookie']).toBe('[REDACTED]');
    });

    it('should handle array values in headers', () => {
      const headers: Record<string, string | string[]> = {
        'Content-Type': 'application/json',
        Accept: ['application/json', 'text/plain'],
      };
      const result = sanitizeHeaders(headers);
      expect(result['Accept']).toEqual(['application/json', 'text/plain']);
    });
  });

  describe('getErrorMessage', () => {
    // Tests error message extraction - ensures safe error handling

    it('should extract message from Error objects', () => {
      const error = new Error('Something went wrong');
      expect(getErrorMessage(error)).toBe('Something went wrong');
    });

    it('should convert string errors to string', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('should convert number errors to string', () => {
      expect(getErrorMessage(404)).toBe('404');
    });

    it('should convert object errors to string', () => {
      const error = { code: 500, message: 'Error' };
      expect(getErrorMessage(error)).toBe('[object Object]');
    });

    it('should handle null errors', () => {
      expect(getErrorMessage(null)).toBe('null');
    });

    it('should handle undefined errors', () => {
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should extract message from custom error classes', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }
      const error = new CustomError('Custom error message');
      expect(getErrorMessage(error)).toBe('Custom error message');
    });
  });

  describe('sanitizeLogData', () => {
    // Tests recursive log data sanitization

    it('should return null/undefined as is', () => {
      expect(sanitizeLogData(null)).toBeNull();
      expect(sanitizeLogData(undefined)).toBeUndefined();
    });

    it('should redact password fields', () => {
      const data = { username: 'john', password: 'secret123' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
    });

    it('should redact token fields', () => {
      const data = { user: 'john', token: 'jwt-token-here' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.token).toBe('[REDACTED]');
    });

    it('should redact secret fields', () => {
      const data = { clientSecret: 'abc123', name: 'app' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.clientSecret).toBe('[REDACTED]');
    });

    it('should redact apiKey fields', () => {
      const data = { apiKey: 'key123', endpoint: '/api' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('should redact api_key fields (snake_case)', () => {
      const data = { api_key: 'key123', endpoint: '/api' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.api_key).toBe('[REDACTED]');
    });

    it('should redact accessToken fields', () => {
      const data = { accessToken: 'token', refreshToken: 'refresh' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.accessToken).toBe('[REDACTED]');
      expect(result.refreshToken).toBe('[REDACTED]');
    });

    it('should redact authorization fields', () => {
      const data = { authorization: 'Bearer xyz', method: 'GET' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('should redact cookie fields', () => {
      const data = { cookie: 'session=123', path: '/' };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.cookie).toBe('[REDACTED]');
    });

    it('should handle nested objects', () => {
      const data = {
        user: {
          name: 'john',
          credentials: {
            password: 'secret',
            apiKey: 'key123',
          },
        },
      };
      const result = sanitizeLogData(data) as Record<string, any>;
      expect(result.user.name).toBe('john');
      expect(result.user.credentials.password).toBe('[REDACTED]');
      expect(result.user.credentials.apiKey).toBe('[REDACTED]');
    });

    it('should handle arrays', () => {
      const data = [
        { name: 'user1', password: 'pass1' },
        { name: 'user2', password: 'pass2' },
      ];
      const result = sanitizeLogData(data) as Array<Record<string, unknown>>;
      expect(result[0].name).toBe('user1');
      expect(result[0].password).toBe('[REDACTED]');
      expect(result[1].password).toBe('[REDACTED]');
    });

    it('should prevent infinite recursion with max depth', () => {
      // Create deeply nested object
      const data: Record<string, unknown> = { level: 0 };
      let current = data;
      for (let i = 1; i <= 10; i++) {
        current.nested = { level: i };
        current = current.nested as Record<string, unknown>;
      }

      const result = sanitizeLogData(data);
      // Should not throw and should handle deep nesting
      expect(result).toBeDefined();
    });

    it('should truncate very long strings', () => {
      // Use non-alphanumeric content to avoid API key detection
      const longString = 'Hello world! '.repeat(1000);
      const result = sanitizeLogData(longString) as string;
      expect(result).toContain('[TRUNCATED]');
      expect(result.length).toBeLessThan(longString.length);
    });

    it('should preserve primitive values', () => {
      expect(sanitizeLogData(42)).toBe(42);
      expect(sanitizeLogData(true)).toBe(true);
      expect(sanitizeLogData('short string')).toBe('short string');
    });

    it('should handle case-insensitive key matching', () => {
      const data = {
        PASSWORD: 'secret1',
        Token: 'token123',
        APIKEY: 'key456',
      };
      const result = sanitizeLogData(data) as Record<string, unknown>;
      expect(result.PASSWORD).toBe('[REDACTED]');
      expect(result.Token).toBe('[REDACTED]');
      expect(result.APIKEY).toBe('[REDACTED]');
    });
  });
});
