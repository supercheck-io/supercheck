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
import { NotificationService, NotificationProvider, NotificationPayload } from './notification.service';
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
    emailTemplateService = module.get<EmailTemplateService>(EmailTemplateService);
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
        const result = await service.sendNotification(emailProvider, basePayload);
        expect(result).toBe(true);
      });

      it('should reject invalid email addresses', async () => {
        const invalidProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: 'invalid-email' },
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
        expect(result).toBe(false);
      });

      it('should reject empty email list', async () => {
        const emptyProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: '' },
        };
        
        const result = await service.sendNotification(emptyProvider, basePayload);
        expect(result).toBe(false);
      });

      it('should validate multiple comma-separated emails', async () => {
        const multiProvider: NotificationProvider = {
          ...emailProvider,
          config: { emails: 'a@test.com, b@test.com, c@test.com' },
        };
        
        const result = await service.sendNotification(multiProvider, basePayload);
        expect(result).toBe(true);
      });
    });

    describe('Slack Provider', () => {
      it('should validate with webhook URL', async () => {
        const result = await service.sendNotification(slackProvider, basePayload);
        expect(result).toBe(true);
      });

      it('should reject without webhook URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...slackProvider,
          config: {},
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
        expect(result).toBe(false);
      });
    });

    describe('Discord Provider', () => {
      it('should validate with discord webhook URL', async () => {
        const result = await service.sendNotification(discordProvider, basePayload);
        expect(result).toBe(true);
      });

      it('should reject without discord webhook URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...discordProvider,
          config: {},
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
        expect(result).toBe(false);
      });
    });

    describe('Telegram Provider', () => {
      it('should validate with bot token and chat ID', async () => {
        const result = await service.sendNotification(telegramProvider, basePayload);
        expect(result).toBe(true);
      });

      it('should reject without bot token', async () => {
        const invalidProvider: NotificationProvider = {
          ...telegramProvider,
          config: { chatId: 'chat-123' },
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
        expect(result).toBe(false);
      });

      it('should reject without chat ID', async () => {
        const invalidProvider: NotificationProvider = {
          ...telegramProvider,
          config: { botToken: 'token' },
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
        expect(result).toBe(false);
      });
    });

    describe('Webhook Provider', () => {
      it('should validate with URL', async () => {
        const result = await service.sendNotification(webhookProvider, basePayload);
        expect(result).toBe(true);
      });

      it('should reject without URL', async () => {
        const invalidProvider: NotificationProvider = {
          ...webhookProvider,
          config: {},
        };
        
        const result = await service.sendNotification(invalidProvider, basePayload);
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
        })
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
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn().mockResolvedValue('Error'),
      });
      
      const result = await service.sendNotification(slackProvider, basePayload);
      expect(result).toBe(false);
    });

    it('should handle network timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);
      
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
        })
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
        })
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
        })
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
  // EMAIL NOTIFICATION TESTS
  // ==========================================================================

  describe('Email Notifications', () => {
    it('should use monitor alert template for monitor events', async () => {
      await service.sendNotification(emailProvider, basePayload);
      
      expect(mockEmailTemplateService.renderMonitorAlertEmail).toHaveBeenCalled();
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
      
      const result = await service.sendNotificationToMultipleProviders(providers, basePayload);
      
      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results).toHaveLength(3);
    });

    it('should handle partial failures', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, text: jest.fn().mockResolvedValue('ok') })
        .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error', text: jest.fn().mockResolvedValue('Error') })
        .mockResolvedValueOnce({ ok: true, text: jest.fn().mockResolvedValue('ok') });
      
      const providers = [slackProvider, discordProvider, webhookProvider];
      const result = await service.sendNotificationToMultipleProviders(providers, basePayload);
      
      expect(result.success).toBe(2);
      expect(result.failed).toBe(1);
    });

    it('should return empty results for no providers', async () => {
      const result = await service.sendNotificationToMultipleProviders([], basePayload);
      
      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('should include error details in results', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      
      const providers = [slackProvider];
      const result = await service.sendNotificationToMultipleProviders(providers, basePayload);
      
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
      
      expect(body.originalPayload.metadata.dashboardUrl).toContain('notification-monitor');
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
      
      expect(body.originalPayload.metadata.dashboardUrl).toContain('notification-run');
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
});
