import { Logger } from '@nestjs/common';
import {
  StandardizedErrorHandler,
  type ErrorContext,
  type StandardError,
} from './standardized-error-handler';

describe('StandardizedErrorHandler', () => {
  let handler: StandardizedErrorHandler;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    handler = new StandardizedErrorHandler();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('error factories', () => {
    it.each([
      [
        'validation',
        () => handler.createValidationError('bad input', { field: 'url' }),
        {
          code: 'VALIDATION_ERROR',
          category: 'validation',
          severity: 'medium',
          retryable: false,
        },
      ],
      [
        'network',
        () => handler.createNetworkError('connection refused', { host: 'x' }),
        {
          code: 'NETWORK_ERROR',
          category: 'network',
          severity: 'high',
          retryable: true,
        },
      ],
      [
        'timeout',
        () => handler.createTimeoutError('timed out', 5000),
        {
          code: 'TIMEOUT_ERROR',
          category: 'network',
          severity: 'medium',
          retryable: true,
        },
      ],
      [
        'authentication',
        () => handler.createAuthenticationError('bad creds', { user: 'x' }),
        {
          code: 'AUTHENTICATION_ERROR',
          category: 'authentication',
          severity: 'high',
          retryable: false,
        },
      ],
      [
        'ssl',
        () => handler.createSslError('expired cert', { host: 'x' }),
        {
          code: 'SSL_ERROR',
          category: 'network',
          severity: 'high',
          retryable: false,
        },
      ],
      [
        'status code',
        () => handler.createStatusCodeError(500, '200-299'),
        {
          code: 'STATUS_CODE_ERROR',
          category: 'business',
          severity: 'medium',
          retryable: true,
        },
      ],
      [
        'content validation',
        () =>
          handler.createContentValidationError('missing keyword', {
            keyword: 'ok',
          }),
        {
          code: 'CONTENT_VALIDATION_ERROR',
          category: 'business',
          severity: 'medium',
          retryable: true,
        },
      ],
      [
        'system',
        () => handler.createSystemError('boom', { stack: 'x' }),
        {
          code: 'SYSTEM_ERROR',
          category: 'system',
          severity: 'critical',
          retryable: true,
        },
      ],
    ] as const)(
      'creates a %s error with the expected metadata',
      (_label, create, expected) => {
        const error = create();

        expect(error).toMatchObject(expected);
        expect(error.message).toBeTruthy();
        expect(error.timestamp).toEqual(expect.any(String));
        expect(error.correlationId).toEqual(expect.any(String));
        expect(error.actionable.userMessage).toBeTruthy();
        expect(error.actionable.suggestedActions.length).toBeGreaterThan(0);
      },
    );

    it('includes the timeout in the timeout error details and message', () => {
      const error = handler.createTimeoutError('slow target', 1500);

      expect(error.details).toEqual({ timeoutMs: 1500 });
      expect(error.actionable.userMessage).toContain('1500ms');
    });

    it('includes actual and expected status in the status code error', () => {
      const error = handler.createStatusCodeError(503, '200-299');

      expect(error.message).toBe('Received status code 503, expected 200-299');
      expect(error.details).toEqual({
        actualStatus: 503,
        expectedStatus: '200-299',
      });
      expect(error.actionable.userMessage).toContain('503');
    });
  });

  describe('correlation ids and context', () => {
    it('generates a unique correlation id when none is provided', () => {
      const first = handler.createValidationError('a', {});
      const second = handler.createValidationError('b', {});

      expect(first.correlationId).toMatch(/^err_\d+_[a-z0-9]+$/);
      expect(first.correlationId).not.toBe(second.correlationId);
    });

    it('prefers the correlation id from the context', () => {
      const context: ErrorContext = { correlationId: 'corr-123' };

      const error = handler.createNetworkError('down', {}, context);

      expect(error.correlationId).toBe('corr-123');
    });

    it('logs critical errors at error level', () => {
      const errorSpy = jest.spyOn(Logger.prototype, 'error');

      handler.createSystemError('boom', {});

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[SYSTEM_ERROR]'),
        expect.objectContaining({ details: {} }),
      );
    });

    it('logs validation errors at warn level', () => {
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      handler.createValidationError('bad', {});

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[VALIDATION_ERROR]'),
        expect.anything(),
      );
    });
  });

  describe('mapError', () => {
    const networkCodes = ['ENOTFOUND', 'ECONNREFUSED'];

    it.each(networkCodes)('maps %s to a network error', (code) => {
      const error = Object.assign(new Error('connect failed'), { code });

      const mapped = handler.mapError(error);

      expect(mapped.code).toBe('NETWORK_ERROR');
      expect(mapped.message).toContain('connect failed');
    });

    it('maps ETIMEDOUT to a timeout error', () => {
      const error = Object.assign(new Error('connect timeout'), {
        code: 'ETIMEDOUT',
      });

      expect(handler.mapError(error).code).toBe('TIMEOUT_ERROR');
    });

    it('maps messages containing "timeout" to a timeout error', () => {
      expect(handler.mapError(new Error('operation timeout')).code).toBe(
        'TIMEOUT_ERROR',
      );
    });

    it('maps CERT_ codes to an SSL error', () => {
      const error = Object.assign(new Error('cert failure'), {
        code: 'CERT_HAS_EXPIRED',
      });

      const mapped = handler.mapError(error);

      expect(mapped.code).toBe('SSL_ERROR');
      expect(mapped.message).toContain('cert failure');
    });

    it('maps certificate messages to an SSL error', () => {
      expect(handler.mapError(new Error('self signed certificate')).code).toBe(
        'SSL_ERROR',
      );
    });

    it.each(['authentication failed', 'server returned 401'])(
      'maps "%s" to an authentication error',
      (message) => {
        expect(handler.mapError(new Error(message)).code).toBe(
          'AUTHENTICATION_ERROR',
        );
      },
    );

    it('maps unknown errors to a system error', () => {
      const mapped = handler.mapError(new Error('something odd'));

      expect(mapped.code).toBe('SYSTEM_ERROR');
      expect(mapped.message).toBe('something odd');
      expect(mapped.details).toEqual({
        originalError: expect.any(Error),
      });
    });

    it('handles string errors', () => {
      const mapped = handler.mapError('plain string failure');

      expect(mapped.code).toBe('SYSTEM_ERROR');
      expect(mapped.message).toBe('plain string failure');
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
    ])('handles %s input', (_label, value) => {
      const mapped = handler.mapError(value);

      expect(mapped.code).toBe('SYSTEM_ERROR');
      expect(mapped.message).toBe('Unknown error occurred');
    });

    it('forwards context to the mapped error', () => {
      const context: ErrorContext = {
        monitorId: 'monitor-1',
        correlationId: 'corr-9',
      };

      const mapped = handler.mapError(new Error('nope'), context);

      expect(mapped.correlationId).toBe('corr-9');
    });
  });

  describe('createUserResponse', () => {
    it('builds a safe user-facing payload without internal details', () => {
      const error = handler.createNetworkError('internal detail', {
        secret: 'hidden',
      });

      const response = handler.createUserResponse(error) as {
        success: boolean;
        error: Record<string, unknown>;
        timestamp: string;
      };

      expect(response.success).toBe(false);
      expect(response.error.code).toBe('NETWORK_ERROR');
      expect(response.error.message).toBe(error.actionable.userMessage);
      expect(response.error.suggestions).toEqual(
        error.actionable.suggestedActions,
      );
      expect(response.error.correlationId).toBe(error.correlationId);
      expect(response.error.retryable).toBe(true);
      expect(response.error.documentation).toBe(
        error.actionable.documentationUrl,
      );
      expect(JSON.stringify(response)).not.toContain('internal detail');
      expect(JSON.stringify(response)).not.toContain('hidden');
    });

    it('omits documentation when the error has none', () => {
      const error: StandardError = {
        ...handler.createSystemError('boom', {}),
        actionable: {
          userMessage: 'user message',
          suggestedActions: [],
        },
      };

      const response = handler.createUserResponse(error) as {
        error: Record<string, unknown>;
      };

      expect(response.error).not.toHaveProperty('documentation');
    });
  });

  describe('shouldAlert', () => {
    it('alerts on critical errors', () => {
      expect(handler.shouldAlert(handler.createSystemError('x', {}))).toBe(
        true,
      );
    });

    it('alerts on high severity non-retryable errors', () => {
      expect(
        handler.shouldAlert(handler.createAuthenticationError('x', {})),
      ).toBe(true);
      expect(handler.shouldAlert(handler.createSslError('x', {}))).toBe(true);
    });

    it('does not alert on high severity retryable errors', () => {
      expect(handler.shouldAlert(handler.createNetworkError('x', {}))).toBe(
        false,
      );
    });

    it('does not alert on medium severity errors', () => {
      expect(handler.shouldAlert(handler.createValidationError('x', {}))).toBe(
        false,
      );
      expect(handler.shouldAlert(handler.createTimeoutError('x', 1))).toBe(
        false,
      );
    });
  });

  describe('getRetryDelay', () => {
    it('returns zero for non-retryable errors', () => {
      const error = handler.createValidationError('x', {});

      expect(handler.getRetryDelay(error, 3)).toBe(0);
    });

    it('grows exponentially with the attempt count', () => {
      const error = handler.createSystemError('x', {});

      const first = handler.getRetryDelay(error, 0);
      const second = handler.getRetryDelay(error, 1);

      expect(first).toBeGreaterThanOrEqual(1000);
      expect(first).toBeLessThanOrEqual(1100);
      expect(second).toBeGreaterThanOrEqual(2000);
      expect(second).toBeLessThanOrEqual(2200);
    });

    it('caps the base delay at 30 seconds', () => {
      const error = handler.createSystemError('x', {});

      const delay = handler.getRetryDelay(error, 10);

      expect(delay).toBeGreaterThanOrEqual(30000);
      expect(delay).toBeLessThanOrEqual(33000);
    });
  });
});
