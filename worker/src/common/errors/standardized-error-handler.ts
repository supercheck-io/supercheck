import { Logger } from '@nestjs/common';

export interface StandardError {
  code: string;
  message: string;
  details?: any;
  timestamp: string;
  correlationId?: string;
  category:
    | 'validation'
    | 'network'
    | 'authentication'
    | 'authorization'
    | 'system'
    | 'business';
  severity: 'low' | 'medium' | 'high' | 'critical';
  retryable: boolean;
  actionable: {
    userMessage: string;
    suggestedActions: string[];
    documentationUrl?: string;
  };
}

export interface ErrorContext {
  monitorId?: string;
  monitorType?: string;
  target?: string;
  userId?: string;
  correlationId?: string;
  metadata?: any;
}

export class StandardizedErrorHandler {
  private readonly logger = new Logger(StandardizedErrorHandler.name);

  // 🟡 HIGH PRIORITY: Standardized error handling

  /**
   * Create standardized error for validation failures
   */
  createValidationError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'VALIDATION_ERROR',
      message,
      details,
      category: 'validation',
      severity: 'medium',
      retryable: false,
      actionable: {
        userMessage: 'Invalid input provided. Please check your configuration.',
        suggestedActions: [
          'Verify all required fields are filled correctly',
          'Check that URLs are properly formatted',
          'Ensure port numbers are between 1-65535',
          'Validate that hostnames contain only allowed characters',
        ],
        documentationUrl: '/docs/monitors/configuration',
      },
      context,
    });
  }

  /**
   * Create standardized error for network failures
   */
  createNetworkError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'NETWORK_ERROR',
      message,
      details,
      category: 'network',
      severity: 'high',
      retryable: true,
      actionable: {
        userMessage:
          'Network connection failed. The target may be unreachable.',
        suggestedActions: [
          'Check that the target URL/hostname is correct',
          'Verify the target is accessible from your network',
          'Check firewall settings if monitoring internal resources',
          'Try again in a few minutes if the issue persists',
        ],
        documentationUrl: '/docs/troubleshooting/network-issues',
      },
      context,
    });
  }

  /**
   * Create standardized error for timeout issues
   */
  createTimeoutError(
    message: string,
    timeoutMs: number,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'TIMEOUT_ERROR',
      message,
      details: { timeoutMs },
      category: 'network',
      severity: 'medium',
      retryable: true,
      actionable: {
        userMessage: `Request timed out after ${timeoutMs}ms. The target may be slow to respond.`,
        suggestedActions: [
          'Check if the target service is running normally',
          'Consider increasing the timeout in monitor configuration',
          'Verify network connectivity to the target',
          "Monitor the target's response time patterns",
        ],
        documentationUrl: '/docs/monitors/timeout-configuration',
      },
      context,
    });
  }

  /**
   * Create standardized error for authentication failures
   */
  createAuthenticationError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'AUTHENTICATION_ERROR',
      message,
      details,
      category: 'authentication',
      severity: 'high',
      retryable: false,
      actionable: {
        userMessage: 'Authentication failed. Please check your credentials.',
        suggestedActions: [
          'Verify username and password are correct',
          'Check if bearer token is valid and not expired',
          'Ensure API key has proper permissions',
          'Test credentials manually against the target',
        ],
        documentationUrl: '/docs/monitors/authentication',
      },
      context,
    });
  }

  /**
   * Create standardized error for SSL/TLS issues
   */
  createSslError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'SSL_ERROR',
      message,
      details,
      category: 'network',
      severity: 'high',
      retryable: false,
      actionable: {
        userMessage: 'SSL/TLS certificate issue detected.',
        suggestedActions: [
          'Check if the SSL certificate is valid and not expired',
          'Verify the certificate chain is complete',
          'Ensure the hostname matches the certificate',
          'Check if intermediate certificates are properly configured',
        ],
        documentationUrl: '/docs/monitors/ssl-troubleshooting',
      },
      context,
    });
  }

  /**
   * Create standardized error for status code mismatches
   */
  createStatusCodeError(
    actualStatus: number,
    expectedStatus: string,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'STATUS_CODE_ERROR',
      message: `Received status code ${actualStatus}, expected ${expectedStatus}`,
      details: { actualStatus, expectedStatus },
      category: 'business',
      severity: 'medium',
      retryable: true,
      actionable: {
        userMessage: `Server returned status ${actualStatus} instead of expected ${expectedStatus}.`,
        suggestedActions: [
          'Check if the target endpoint is functioning correctly',
          'Verify the expected status codes configuration',
          'Review server logs for the target application',
          'Test the endpoint manually to confirm behavior',
        ],
        documentationUrl: '/docs/monitors/status-codes',
      },
      context,
    });
  }

  /**
   * Create standardized error for content validation failures
   */
  createContentValidationError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'CONTENT_VALIDATION_ERROR',
      message,
      details,
      category: 'business',
      severity: 'medium',
      retryable: true,
      actionable: {
        userMessage: 'Response content did not match expected criteria.',
        suggestedActions: [
          'Check if the expected keyword/content is still present',
          "Verify the response format hasn't changed",
          'Test the endpoint manually to see current response',
          'Update content validation rules if the change is expected',
        ],
        documentationUrl: '/docs/monitors/content-validation',
      },
      context,
    });
  }

  /**
   * Create standardized error for system issues
   */
  createSystemError(
    message: string,
    details: any,
    context?: ErrorContext,
  ): StandardError {
    return this.createError({
      code: 'SYSTEM_ERROR',
      message,
      details,
      category: 'system',
      severity: 'critical',
      retryable: true,
      actionable: {
        userMessage: 'A system error occurred. Our team has been notified.',
        suggestedActions: [
          'Try again in a few minutes',
          'Contact support if the issue persists',
          'Check system status page for known issues',
        ],
        documentationUrl: '/docs/support/system-errors',
      },
      context,
    });
  }

  /**
   * Core error creation method
   */
  private createError(params: {
    code: string;
    message: string;
    details: any;
    category: StandardError['category'];
    severity: StandardError['severity'];
    retryable: boolean;
    actionable: StandardError['actionable'];
    context?: ErrorContext;
  }): StandardError {
    const error: StandardError = {
      code: params.code,
      message: params.message,
      details: params.details,
      timestamp: new Date().toISOString(),
      correlationId:
        params.context?.correlationId || this.generateCorrelationId(),
      category: params.category,
      severity: params.severity,
      retryable: params.retryable,
      actionable: params.actionable,
    };

    // Log error based on severity
    const logContext = {
      correlationId: error.correlationId,
      monitorId: params.context?.monitorId,
      monitorType: params.context?.monitorType,
      target: params.context?.target,
      userId: params.context?.userId,
    };

    switch (params.severity) {
      case 'critical':
        this.logger.error(`[${error.code}] ${error.message}`, {
          ...logContext,
          details: params.details,
        });
        break;
      case 'high':
        this.logger.error(`[${error.code}] ${error.message}`, {
          ...logContext,
          details: params.details,
        });
        break;
      case 'medium':
        this.logger.warn(`[${error.code}] ${error.message}`, {
          ...logContext,
          details: params.details,
        });
        break;
      case 'low':
        this.logger.log(`[${error.code}] ${error.message}`, {
          ...logContext,
          details: params.details,
        });
        break;
    }

    return error;
  }

  /**
   * Map common errors to standardized format
   */
  mapError(error: any, context?: ErrorContext): StandardError {
    // Network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return this.createNetworkError(
        `Connection failed: ${error.message}`,
        { originalError: error.code },
        context,
      );
    }

    // Timeout errors
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      return this.createTimeoutError(
        'Request timed out',
        30000, // Default timeout
        context,
      );
    }

    // SSL errors
    if (
      error.code?.startsWith('CERT_') ||
      error.message?.includes('certificate')
    ) {
      return this.createSslError(
        `SSL/TLS error: ${error.message}`,
        { originalError: error.code },
        context,
      );
    }

    // Authentication errors
    if (
      error.message?.includes('authentication') ||
      error.message?.includes('401')
    ) {
      return this.createAuthenticationError(
        'Authentication failed',
        { originalError: error.message },
        context,
      );
    }

    // Default to system error
    return this.createSystemError(
      error.message || 'Unknown error occurred',
      { originalError: error },
      context,
    );
  }

  /**
   * Generate correlation ID for error tracking
   */
  private generateCorrelationId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Create user-friendly error response
   */
  createUserResponse(error: StandardError): any {
    return {
      success: false,
      error: {
        code: error.code,
        message: error.actionable.userMessage,
        suggestions: error.actionable.suggestedActions,
        correlationId: error.correlationId,
        retryable: error.retryable,
        ...(error.actionable.documentationUrl && {
          documentation: error.actionable.documentationUrl,
        }),
      },
      timestamp: error.timestamp,
    };
  }

  /**
   * Check if error should trigger alert
   */
  shouldAlert(error: StandardError): boolean {
    return (
      error.severity === 'critical' ||
      (error.severity === 'high' && !error.retryable)
    );
  }

  /**
   * Get retry delay based on error type and attempt count
   */
  getRetryDelay(error: StandardError, attemptCount: number): number {
    if (!error.retryable) {
      return 0;
    }

    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds

    const delay = Math.min(baseDelay * Math.pow(2, attemptCount), maxDelay);
    const jitter = Math.random() * 0.1 * delay; // 10% jitter

    return delay + jitter;
  }
}
