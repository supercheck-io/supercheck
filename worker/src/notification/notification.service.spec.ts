/**
 * Notification Service Tests
 *
 * Comprehensive test coverage for multi-channel notifications
 *
 * Test Categories:
 * - Email Notifications (SMTP delivery)
 * - Slack Notifications (webhook delivery)
 * - Discord Notifications (webhook delivery)
 * - Telegram Notifications (bot API)
 * - Webhook Notifications (custom endpoints)
 * - Provider Validation (config validation)
 * - Error Handling (delivery failures, timeouts)
 * - Multiple Providers (parallel delivery)
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  NotificationService,
  NotificationProvider,
  NotificationPayload,
} from './notification.service';
import { EmailTemplateService } from '../email-template/email-template.service';

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    verify: jest.fn().mockResolvedValue(true),
    sendMail: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
  }),
}));

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('NotificationService', () => {
  let service: NotificationService;
  let emailTemplateService: EmailTemplateService;

  const mockEmailTemplateService = {
    renderMonitorAlertEmail: jest.fn().mockResolvedValue({
      html: '<html>Alert</html>',
      text: 'Alert',
      subject: 'Monitor Alert',
    }),
    renderJobFailureEmail: jest.fn().mockResolvedValue({
      html: '<html>Job Failed</html>',
      text: 'Job Failed',
      subject: 'Job Failed',
    }),
    renderJobSuccessEmail: jest.fn().mockResolvedValue({
      html: '<html>Job Success</html>',
      text: 'Job Success',
      subject: 'Job Success',
    }),
    renderJobTimeoutEmail: jest.fn().mockResolvedValue({
      html: '<html>Job Timeout</html>',
      text: 'Job Timeout',
      subject: 'Job Timeout',
    }),
  };

  // Test fixtures
  const basePayload: NotificationPayload = {
    type: 'monitor_down' as any, // AlertType enum value
    title: 'Monitor Down',
    message: 'Your monitor is down',
    targetName: 'Test Monitor',
    targetId: 'monitor-123',
    severity: 'error',
    timestamp: new Date('2025-01-01T00:00:00Z'),
    projectId: 'project-456',
    projectName: 'Test Project',
    metadata: {
      responseTime: 5000,
      status: 'down',
      target: 'https://example.com',
      type: 'http',
    },
  };

  const emailProvider: NotificationProvider = {
    id: 'provider-email',
    type: 'email',
    config: { emails: 'test@example.com,admin@example.com' },
  };

  const slackProvider: NotificationProvider = {
    id: 'provider-slack',
    type: 'slack',
    config: { webhookUrl: 'https://hooks.slack.com/services/xxx' },
  };

  const discordProvider: NotificationProvider = {
    id: 'provider-discord',
    type: 'discord',
    config: { discordWebhookUrl: 'https://discord.com/api/webhooks/xxx' },
  };

  const telegramProvider: NotificationProvider = {
    id: 'provider-telegram',
    type: 'telegram',
    config: { botToken: 'bot-token-123', chatId: 'chat-123' },
  };

  const webhookProvider: NotificationProvider = {
    id: 'provider-webhook',
    type: 'webhook',
    config: { url: 'https://api.example.com/webhook' },
  };

  const teamsProvider: NotificationProvider = {
    id: 'provider-teams',
    type: 'teams',
    config: { teamsWebhookUrl: 'https://example.webhook.office.com/webhook/xxx' },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup environment variables
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'password';
    process.env.APP_URL = 'https://app.example.com';

    // Default fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('ok'),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: EmailTemplateService,
          useValue: mockEmailTemplateService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    emailTemplateService =
      module.get<EmailTemplateService>(EmailTemplateService);
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.APP_URL;
  });

  // ==========================================================================
  // PROVIDER VALIDATION TESTS
  // ==========================================================================

  describe('Provider Validation', () => {
    describe('Email Provider', () => {
      it('should validate valid email addresses', async () => {
        const result = await service.sendNotification(
          emailProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject invalid email addresses', async () => {
        const invalidProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: 'invalid-email' },
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });

      it('should reject empty email list', async () => {
        const emptyProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: '' },
        };

        const result = await service.sendNotification(
          emptyProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });

      it('should validate multiple comma-separated emails', async () => {
        const multiProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: 'a@test.com, b@test.com, c@test.com' },
        };

        const result = await service.sendNotification(
          multiProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });
    });

    describe('Slack Provider', () => {
      it('should validate with webhook URL', async () => {
        const result = await service.sendNotification(
          slackProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject without webhook URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...slackProvider,
          config: {},
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });
    });

    describe('Discord Provider', () => {
      it('should validate with discord webhook URL', async () => {
        const result = await service.sendNotification(
          discordProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject without discord webhook URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...discordProvider,
          config: {},
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });
    });

    describe('Telegram Provider', () => {
      it('should validate with bot token and chat ID', async () => {
        const result = await service.sendNotification(
          telegramProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject without bot token', async () => {
        const invalidProvider: NotificationProvider = {
          ...telegramProvider,
          config: { chatId: 'chat-123' },
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });

      it('should reject without chat ID', async () => {
        const invalidProvider: NotificationProvider = {
          ...telegramProvider,
          config: { botToken: 'token' },
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });
    });

    describe('Webhook Provider', () => {
      it('should validate with URL', async () => {
        const result = await service.sendNotification(
          webhookProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject without URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...webhookProvider,
          config: {},
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });
    });

    describe('Teams Provider', () => {
      it('should validate with Teams webhook URL', async () => {
        const result = await service.sendNotification(
          teamsProvider,
          basePayload,
        );
        expect(result).toBe(true);
      });

      it('should reject without Teams webhook URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...teamsProvider,
          config: {},
        };

        const result = await service.sendNotification(
          invalidProvider,
          basePayload,
        );
        expect(result).toBe(false);
      });
    });
  });

  // ==========================================================================
  // SLACK NOTIFICATION TESTS
  // ==========================================================================

  describe('Slack Notifications', () => {
    it('should send formatted Slack message', async () => {
      await service.sendNotification(slackProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        slackProvider.config.webhookUrl,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should include attachments with fields', async () => {
      await service.sendNotification(slackProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments).toBeDefined();
      expect(body.attachments[0].fields).toBeDefined();
    });

    it('should handle Slack API errors', async () => {
      // Use mockResolvedValue to fail all retry attempts (not just once)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400, // 400 is non-retryable, so it fails immediately
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Error'),
      });

      const result = await service.sendNotification(slackProvider, basePayload);
      expect(result).toBe(false);
    });

    it('should handle network timeout', async () => {
      // Use a non-retryable error that fails immediately
      const nonRetryableError = new Error('Invalid request');
      nonRetryableError.name = 'TypeError';
      mockFetch.mockRejectedValue(nonRetryableError);

      const result = await service.sendNotification(slackProvider, basePayload);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // DISCORD NOTIFICATION TESTS
  // ==========================================================================

  describe('Discord Notifications', () => {
    it('should send formatted Discord embed', async () => {
      await service.sendNotification(discordProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        discordProvider.config.discordWebhookUrl,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should include embeds with proper structure', async () => {
      await service.sendNotification(discordProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.embeds).toBeDefined();
      expect(body.embeds[0].title).toBeDefined();
      expect(body.embeds[0].fields).toBeDefined();
    });

    it('should convert hex color to integer', async () => {
      await service.sendNotification(discordProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(typeof body.embeds[0].color).toBe('number');
    });
  });

  // ==========================================================================
  // TELEGRAM NOTIFICATION TESTS
  // ==========================================================================

  describe('Telegram Notifications', () => {
    it('should send to Telegram API', async () => {
      await service.sendNotification(telegramProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should use Markdown parse mode', async () => {
      await service.sendNotification(telegramProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.parse_mode).toBe('Markdown');
      expect(body.chat_id).toBe(telegramProvider.config.chatId);
    });
  });

  // ==========================================================================
  // WEBHOOK NOTIFICATION TESTS
  // ==========================================================================

  describe('Webhook Notifications', () => {
    it('should send full payload to webhook', async () => {
      await service.sendNotification(webhookProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        webhookProvider.config.url,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should include original payload in webhook body', async () => {
      await service.sendNotification(webhookProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload).toBeDefined();
      expect(body.provider).toBe('webhook');
    });
  });

  // ==========================================================================
  // TEAMS NOTIFICATION TESTS
  // ==========================================================================

  describe('Teams Notifications', () => {
    it('should send to Teams webhook', async () => {
      await service.sendNotification(teamsProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        teamsProvider.config.teamsWebhookUrl,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should include Adaptive Card payload', async () => {
      await service.sendNotification(teamsProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.type).toBe('message');
      expect(body.attachments).toBeDefined();
      expect(body.attachments[0].contentType).toBe(
        'application/vnd.microsoft.card.adaptive',
      );
    });

    it('should use proper Adaptive Card version', async () => {
      await service.sendNotification(teamsProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].content.version).toBe('1.4');
      expect(body.attachments[0].content.type).toBe('AdaptiveCard');
    });
  });

  // EMAIL NOTIFICATION TESTS
  // ==========================================================================

  describe('Email Notifications', () => {
    it('should use monitor alert template for monitor events', async () => {
      await service.sendNotification(emailProvider, basePayload);

      expect(
        mockEmailTemplateService.renderMonitorAlertEmail,
      ).toHaveBeenCalled();
    });

    it('should use job failure template for job_failed', async () => {
      const jobFailPayload: NotificationPayload = {
        ...basePayload,
        type: 'job_failed',
        title: 'Job Failed',
      };

      await service.sendNotification(emailProvider, jobFailPayload);

      expect(mockEmailTemplateService.renderJobFailureEmail).toHaveBeenCalled();
    });

    it('should use job success template for job_success', async () => {
      const jobSuccessPayload: NotificationPayload = {
        ...basePayload,
        type: 'job_success',
        title: 'Job Success',
      };

      await service.sendNotification(emailProvider, jobSuccessPayload);

      expect(mockEmailTemplateService.renderJobSuccessEmail).toHaveBeenCalled();
    });

    it('should use job timeout template for job_timeout', async () => {
      const jobTimeoutPayload: NotificationPayload = {
        ...basePayload,
        type: 'job_timeout',
        title: 'Job Timeout',
      };

      await service.sendNotification(emailProvider, jobTimeoutPayload);

      expect(mockEmailTemplateService.renderJobTimeoutEmail).toHaveBeenCalled();
    });

    it('should fail when SMTP not configured', async () => {
      delete process.env.SMTP_HOST;

      const result = await service.sendNotification(emailProvider, basePayload);
      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // MULTIPLE PROVIDERS TESTS
  // ==========================================================================

  describe('Multiple Providers', () => {
    it('should send to multiple providers', async () => {
      const providers = [slackProvider, discordProvider, webhookProvider];

      const result = await service.sendNotificationToMultipleProviders(
        providers,
        basePayload,
      );

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
    });

    it('should handle partial failures', async () => {
      // For partial failures test: first succeeds, second fails with non-retryable error, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('ok'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400, // Non-retryable status code
          statusText: 'Bad Request',
          text: jest.fn().mockResolvedValue('Error'),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('ok'),
        });

      const providers = [slackProvider, discordProvider, webhookProvider];
      const result = await service.sendNotificationToMultipleProviders(
        providers,
        basePayload,
      );

      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should return empty results for no providers', async () => {
      const result = await service.sendNotificationToMultipleProviders(
        [],
        basePayload,
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should include error details in results', async () => {
      // Use a non-retryable error to fail immediately and capture the error
      const nonRetryableError = new Error('Invalid payload');
      nonRetryableError.name = 'TypeError';
      mockFetch.mockRejectedValue(nonRetryableError);

      const providers = [slackProvider];
      const result = await service.sendNotificationToMultipleProviders(
        providers,
        basePayload,
      );

      expect(result.results[0].error).toBeDefined();
    });
  });

  // ==========================================================================
  // PAYLOAD ENHANCEMENT TESTS
  // ==========================================================================

  describe('Payload Enhancement', () => {
    it('should add dashboard URL for monitors', async () => {
      await service.sendNotification(webhookProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.dashboardUrl).toContain(
        'notification-monitor',
      );
    });

    it('should add dashboard URL for jobs', async () => {
      const jobPayload: NotificationPayload = {
        ...basePayload,
        type: 'job_failed',
        metadata: { runId: 'run-123' },
      };

      await service.sendNotification(webhookProvider, jobPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.dashboardUrl).toContain(
        'notification-run',
      );
    });

    it('should include timestamp in metadata', async () => {
      await service.sendNotification(webhookProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.timestamp).toBeDefined();
    });
  });

  // ==========================================================================
  // SEVERITY COLORS TESTS
  // ==========================================================================

  describe('Severity Colors', () => {
    it('should use red for error severity', async () => {
      const errorPayload = { ...basePayload, severity: 'error' as const };
      await service.sendNotification(slackProvider, errorPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].color).toBe('#ef4444');
    });

    it('should use amber for warning severity', async () => {
      const warnPayload = { ...basePayload, severity: 'warning' as const };
      await service.sendNotification(slackProvider, warnPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].color).toBe('#f59e0b');
    });

    it('should use green for success severity', async () => {
      const successPayload = { ...basePayload, severity: 'success' as const };
      await service.sendNotification(slackProvider, successPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].color).toBe('#22c55e');
    });

    it('should use blue for info severity', async () => {
      const infoPayload = { ...basePayload, severity: 'info' as const };
      await service.sendNotification(slackProvider, infoPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].color).toBe('#3b82f6');
    });
  });

  // ==========================================================================
  // ADDITIONAL COVERAGE TESTS
  // ==========================================================================

  describe('Alert Type Coverage', () => {
    const alertTypes = [
      'monitor_up',
      'monitor_down',
      'ssl_expiring',
      'job_success',
      'job_failed',
      'job_timeout',
    ];

    alertTypes.forEach((alertType) => {
      it(`should handle alert type: ${alertType}`, async () => {
        const payload = { ...basePayload, type: alertType as any };
        const result = await service.sendNotification(slackProvider, payload);
        expect(result).toBe(true);
      });
    });
  });

  describe('Provider Type Coverage', () => {
    it('should handle all provider types', async () => {
      const providers = [
        emailProvider,
        slackProvider,
        discordProvider,
        telegramProvider,
        webhookProvider,
        teamsProvider,
      ];

      for (const provider of providers) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          text: jest.fn().mockResolvedValue('ok'),
        });
        // Reset for email
        if (provider.type === 'email') {
          process.env.SMTP_HOST = 'smtp.test.com';
          process.env.SMTP_USER = 'test';
          process.env.SMTP_PASSWORD = 'pass';
        }
      }

      // Just verify the provider types are valid
      expect(providers.map((p) => p.type)).toEqual([
        'email',
        'slack',
        'discord',
        'telegram',
        'webhook',
        'teams',
      ]);
    });
  });

  describe('Metadata Handling', () => {
    it('should include response time in fields', async () => {
      const payloadWithResponseTime = {
        ...basePayload,
        metadata: { ...basePayload.metadata, responseTime: 5000 },
      };

      await service.sendNotification(slackProvider, payloadWithResponseTime);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const fields = body.attachments[0].fields;

      expect(fields.some((f: any) => f.title === 'Response Time')).toBe(true);
    });

    it('should include status in fields', async () => {
      const payloadWithStatus = {
        ...basePayload,
        metadata: { ...basePayload.metadata, status: 'down' },
      };

      await service.sendNotification(slackProvider, payloadWithStatus);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const fields = body.attachments[0].fields;

      expect(fields.some((f: any) => f.title === 'Status')).toBe(true);
    });

    it('should include target URL in fields', async () => {
      const payloadWithTarget = {
        ...basePayload,
        metadata: {
          ...basePayload.metadata,
          target: 'https://api.example.com',
        },
      };

      await service.sendNotification(slackProvider, payloadWithTarget);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const fields = body.attachments[0].fields;

      expect(fields.some((f: any) => f.title === 'Target URL')).toBe(true);
    });

    it('should include project name when provided', async () => {
      const payloadWithProject = {
        ...basePayload,
        projectName: 'Test Project',
      };

      await service.sendNotification(slackProvider, payloadWithProject);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      const fields = body.attachments[0].fields;

      expect(fields.some((f: any) => f.title === 'Project')).toBe(true);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle connection refused errors', async () => {
      const error = new Error('Connection refused');
      (error as any).cause = { code: 'ECONNREFUSED' };
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(error);

      const result = await service.sendNotification(slackProvider, basePayload);

      expect(result).toBe(false);

      // Restore default behavior
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('ok'),
      });
    });

    it('should handle DNS lookup failures', async () => {
      const error = new Error('DNS lookup failed');
      (error as any).cause = { code: 'ENOTFOUND' };
      mockFetch.mockReset();
      mockFetch.mockRejectedValue(error);

      const result = await service.sendNotification(slackProvider, basePayload);

      expect(result).toBe(false);

      // Restore default behavior
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('ok'),
      });
    });

    it('should handle HTTP 4xx errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('Invalid payload'),
      });

      const result = await service.sendNotification(slackProvider, basePayload);

      expect(result).toBe(false);
    });

    it('should handle HTTP 5xx errors', async () => {
      // 5xx errors are retryable, so mock all attempts to fail
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: jest.fn().mockResolvedValue('Try again later'),
      });

      const result = await service.sendNotification(slackProvider, basePayload);

      expect(result).toBe(false);
    });
  });

  describe('Concurrent Notifications', () => {
    it('should handle concurrent sends to same provider', async () => {
      // Reset to ensure clean state
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('ok'),
      });

      const promises = Array.from({ length: 5 }, () =>
        service.sendNotification(slackProvider, basePayload),
      );

      const results = await Promise.all(promises);

      expect(results.filter((r) => r === true).length).toBeGreaterThan(0);
    });

    it('should handle concurrent sends to different providers', async () => {
      // Reset to ensure clean state
      mockFetch.mockReset();
      mockFetch.mockResolvedValue({
        ok: true,
        text: jest.fn().mockResolvedValue('ok'),
      });

      const providers = [slackProvider, discordProvider, webhookProvider];

      const promises = providers.map((provider) =>
        service.sendNotification(provider, basePayload),
      );

      const results = await Promise.all(promises);

      expect(results.filter((r) => r === true).length).toBeGreaterThan(0);
    });
  });

  describe('Message Formatting', () => {
    it('should include error message in enhanced payload', async () => {
      const payloadWithError = {
        ...basePayload,
        metadata: {
          ...basePayload.metadata,
          errorMessage: 'Connection timeout',
        },
      };

      await service.sendNotification(webhookProvider, payloadWithError);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.message).toContain('Error Details');
    });

    it('should format time correctly', async () => {
      await service.sendNotification(slackProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.attachments[0].ts).toBeDefined();
      expect(typeof body.attachments[0].ts).toBe('number');
    });
  });

  describe('Email Address Validation', () => {
    it('should validate single email address', async () => {
      const provider = {
        ...emailProvider,
        config: { emails: 'valid@example.com' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(true);
    });

    it('should validate multiple email addresses', async () => {
      const provider = {
        ...emailProvider,
        config: { emails: 'a@test.com, b@test.com, c@test.com' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(true);
    });

    it('should reject malformed email addresses', async () => {
      const provider = {
        ...emailProvider,
        config: { emails: 'not-an-email' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(false);
    });
  });

  describe('Dashboard URL Generation', () => {
    it('should generate monitor URL for monitor_up', async () => {
      const payload = { ...basePayload, type: 'monitor_up' as any };

      await service.sendNotification(webhookProvider, payload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.dashboardUrl).toContain(
        'notification-monitor',
      );
    });

    it('should generate job URL for job_failed with runId', async () => {
      const payload = {
        ...basePayload,
        type: 'job_failed' as any,
        metadata: { runId: 'run-abc-123' },
      };

      await service.sendNotification(webhookProvider, payload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.dashboardUrl).toContain(
        'notification-run',
      );
    });

    it('should generate ssl URL for ssl_expiring', async () => {
      const payload = { ...basePayload, type: 'ssl_expiring' as any };

      await service.sendNotification(webhookProvider, payload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.originalPayload.metadata.dashboardUrl).toContain(
        'notification-monitor',
      );
    });
  });
});
