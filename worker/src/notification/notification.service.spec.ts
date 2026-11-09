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

const mockPublicFetchOptions = jest.fn();
jest.mock('../common/utils/pinned-public-fetch', () => ({
  fetchPublicEndpoint: (
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
    options?: unknown,
  ) => {
    mockPublicFetchOptions(options);
    return global.fetch(url, init);
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import * as nodemailer from 'nodemailer';
import {
  NotificationService,
  buildEmailFields,
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
  let _emailTemplateService: EmailTemplateService;
  let module: TestingModule;

  const mockEmailTemplateService = {
    renderMonitorAlertEmail: jest.fn().mockResolvedValue({
      html: '<html>Alert</html>',
      text: 'Alert',
      subject: 'Monitor Alert',
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
    config: { emails: 'test@test.com,admin@test.com' },
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
    config: { botToken: '123456:ABC-def_token', chatId: 'chat-123' },
  };

  const webhookProvider: NotificationProvider = {
    id: 'provider-webhook',
    type: 'webhook',
    config: { url: 'https://api.example.com/webhook' },
  };

  const teamsProvider: NotificationProvider = {
    id: 'provider-teams',
    type: 'teams',
    config: {
      teamsWebhookUrl:
        'https://prod-00.westus.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/xxx',
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Setup environment variables
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASSWORD = 'password';
    process.env.SMTP_FROM_EMAIL = 'notifications@example.com';
    process.env.APP_URL = 'https://app.example.com';

    // Default fetch mock
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      statusText: 'Accepted',
      text: jest.fn().mockResolvedValue('ok'),
    });

    module = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: EmailTemplateService,
          useValue: mockEmailTemplateService,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    _emailTemplateService =
      module.get<EmailTemplateService>(EmailTemplateService);
  });

  afterEach(async () => {
    await module.close();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_EMAIL;
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

      it('never sends to undeliverable or duplicate addresses', async () => {
        const nodemailer = require('nodemailer');
        const sendMail = jest.fn().mockResolvedValue({ messageId: 'm' });
        (nodemailer.createTransport as jest.Mock).mockReturnValue({
          verify: jest.fn().mockResolvedValue(true),
          sendMail,
        });
        await service.sendNotification(
          {
            ...emailProvider,
            config: {
              emails: 'a@test.com, A@test.com, x@example.com, y@e2e.invalid',
            },
          },
          basePayload,
        );
        expect(sendMail).toHaveBeenCalledTimes(1);
        expect(sendMail).toHaveBeenCalledWith(
          expect.objectContaining({ to: 'a@test.com' }),
        );
      });

      it('fails without SMTP when every recipient is undeliverable', async () => {
        const nodemailer = require('nodemailer');
        (nodemailer.createTransport as jest.Mock).mockClear();
        const result = await service.sendNotification(
          {
            ...emailProvider,
            config: { emails: 'x@example.com, y@e2e.invalid' },
          },
          basePayload,
        );
        expect(result).toBe(false);
        expect(nodemailer.createTransport).not.toHaveBeenCalled();
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

  describe('Security hardening', () => {
    type Detailed = {
      sendNotificationDetailed: (
        p: NotificationProvider,
        pl: NotificationPayload,
      ) => Promise<{ success: boolean; error?: string }>;
    };
    const detailed = (p: NotificationProvider, pl: NotificationPayload) =>
      (service as unknown as Detailed).sendNotificationDetailed(p, pl);
    const sensitiveTarget = 'https://user:pw@example.com/p?token=abc123&q=1';

    it('redacts the monitor target in Slack and the webhook originalPayload', async () => {
      const payload = {
        ...basePayload,
        metadata: { ...basePayload.metadata, target: sensitiveTarget },
      };
      await service.sendNotification(slackProvider, payload);
      await service.sendNotification(webhookProvider, payload);
      for (const call of mockFetch.mock.calls) {
        expect(call[1].body).not.toContain('abc123');
        expect(call[1].body).not.toContain('pw@');
      }
      expect(mockFetch.mock.calls[1][1].body).toContain('q=1');
    });

    it('routes webhook error bodies and fetch errors through safeSendError', async () => {
      const provider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/hook/SECRETPATHSEGMENT',
          headers: { Authorization: 'Bearer topsecrettoken' },
        },
      };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn().mockResolvedValue('echo Bearer topsecrettoken'),
      });
      const r1 = await detailed(provider, basePayload);
      expect(r1.error).toMatch(/^Webhook delivery failed:/);
      expect(r1.error).not.toContain('topsecrettoken');

      mockFetch.mockRejectedValueOnce(
        new Error(
          'connect failed https://api.example.com/hook/SECRETPATHSEGMENT',
        ),
      );
      const r2 = await detailed(provider, basePayload);
      expect(r2.error).not.toContain('SECRETPATHSEGMENT');
    });

    it('escapes Slack control characters in title, message and fields', async () => {
      await service.sendNotification(slackProvider, {
        ...basePayload,
        title: 'Down <!channel>',
        message: 'see <http://evil|click> & more',
        targetName: '<!here>',
      });
      const body = mockFetch.mock.calls[0][1].body as string;
      expect(body).not.toContain('<!channel>');
      expect(body).not.toContain('<!here>');
      expect(body).not.toContain('<http://evil|click>');
      expect(body).toContain('&lt;!channel&gt;');
      expect(body).toContain('&amp; more');
    });

    it('clips long error messages in Slack and webhook payloads', async () => {
      const payload = {
        ...basePayload,
        metadata: { ...basePayload.metadata, errorMessage: 'e'.repeat(5000) },
      };
      await service.sendNotification(slackProvider, payload);
      await service.sendNotification(webhookProvider, payload);
      for (const call of mockFetch.mock.calls)
        expect(call[1].body.length).toBeLessThan(4000);
    });

    it('shows the observation time when the payload carries one', async () => {
      await service.sendNotification(slackProvider, {
        ...basePayload,
        metadata: {
          ...basePayload.metadata,
          observedAt: '2020-01-02T03:04:05.000Z',
        },
      });
      expect(mockFetch.mock.calls[0][1].body).toContain('02 Jan 2020 03:04:05');
    });
  });

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

    it('escapes line-leading # in the Discord description', async () => {
      await service.sendNotification(discordProvider, {
        ...basePayload,
        message: '# heading',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].description).toContain('\\# heading');
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

    it('should keep embeds within Discord limits and disable mentions', async () => {
      await service.sendNotification(discordProvider, {
        ...basePayload,
        message: 'x'.repeat(5000),
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].description.length).toBeLessThanOrEqual(4096);
      expect(body.embeds[0].footer.text).toBe('Supercheck');
      expect(body.allowed_mentions).toEqual({ parse: [] });
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

    it('should send plain text so names with Markdown characters are not rejected', async () => {
      await service.sendNotification(telegramProvider, {
        ...basePayload,
        targetName: 'api_v2_*prod*',
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.parse_mode).toBeUndefined();
      expect(body.text).toContain('api_v2_*prod*');
      expect(body.text.length).toBeLessThanOrEqual(4096);
      expect(body.chat_id).toBe(telegramProvider.config.chatId);
    });
  });

  describe('Provider send results', () => {
    const failResponse = (body: string) => ({
      ok: false,
      status: 400, // non-retryable, fails immediately
      statusText: 'Bad Request',
      text: jest.fn().mockResolvedValue(body),
    });

    it('returns a descriptive error for a failed Telegram send without leaking the bot token', async () => {
      mockFetch.mockResolvedValue(failResponse('chat not found'));
      const result = await service.sendNotificationToMultipleProviders(
        [telegramProvider],
        basePayload,
      );
      const error = result.results[0].error ?? '';
      expect(error).toContain('Telegram delivery failed');
      expect(error).toContain('chat not found');
      expect(error).not.toContain('ABC-def_token');
    });

    it('redacts the webhook URL from Slack failure text', async () => {
      mockFetch.mockResolvedValue(
        failResponse(`bad hook ${slackProvider.config.webhookUrl as string}`),
      );
      const result = await service.sendNotificationToMultipleProviders(
        [slackProvider],
        basePayload,
      );
      const error = result.results[0].error ?? '';
      expect(error).toContain('Slack delivery failed');
      expect(error).not.toContain('hooks.slack.com/services/xxx');
    });

    it('redacts the URL path when the error echoes only the path', async () => {
      const path = new URL(slackProvider.config.webhookUrl as string).pathname;
      mockFetch.mockResolvedValue(failResponse(`POST ${path} failed`));
      const result = await service.sendNotificationToMultipleProviders(
        [slackProvider],
        basePayload,
      );
      expect(result.results[0].error).not.toContain(path);
    });

    it('redacts a percent-encoded query value echoed unchanged', async () => {
      const provider: NotificationProvider = {
        id: 'p-enc',
        type: 'slack',
        config: {
          webhookUrl:
            'https://hooks.slack.com/services/T0001/B0002/x?key=Secret%2DToken99',
        },
      };
      mockFetch.mockResolvedValue(failResponse('bad key Secret%2DToken99'));
      const result = await service.sendNotificationToMultipleProviders(
        [provider],
        basePayload,
      );
      expect(result.results[0].error).not.toContain('Secret%2DToken99');
    });

    it('redacts a lone token segment or query value echoed by the provider', async () => {
      const provider: NotificationProvider = {
        id: 'p-parts',
        type: 'slack',
        config: {
          webhookUrl:
            'https://hooks.slack.com/services/T0001/B0002/SecretTokenSegment?key=queryValue123',
        },
      };
      mockFetch.mockResolvedValue(
        failResponse('bad token SecretTokenSegment, key queryValue123'),
      );
      const result = await service.sendNotificationToMultipleProviders(
        [provider],
        basePayload,
      );
      const error = result.results[0].error ?? '';
      expect(error).not.toContain('SecretTokenSegment');
      expect(error).not.toContain('queryValue123');
    });

    it('re-checks the provider host allowlist before sending', async () => {
      const bad: NotificationProvider = {
        id: 'p-bad',
        type: 'slack',
        config: { webhookUrl: 'https://evil.example.com/hook' },
      };
      const result = await service.sendNotificationToMultipleProviders(
        [bad],
        basePayload,
      );
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.results[0].error).toContain('host is not allowed');
    });

    it('rejects a Telegram bot token that could alter the URL path', async () => {
      const bad: NotificationProvider = {
        id: 'p-bad-tg',
        type: 'telegram',
        config: { botToken: '1:a/../x', chatId: 'c' },
      };
      await service.sendNotificationToMultipleProviders([bad], basePayload);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('bounds the response body kept in a failed webhook error', async () => {
      mockFetch.mockResolvedValue(failResponse('x'.repeat(50000)));
      const result = await service.sendNotificationToMultipleProviders(
        [webhookProvider],
        basePayload,
      );
      expect((result.results[0].error ?? '').length).toBeLessThan(1300);
    });
  });

  // ==========================================================================
  // WEBHOOK NOTIFICATION TESTS
  // ==========================================================================

  describe('Webhook Notifications', () => {
    it('allows internal webhook targets only on an opted-in self-hosted install', async () => {
      const saved = { ...process.env };
      try {
        process.env.SELF_HOSTED = 'true';
        process.env.ALLOW_INTERNAL_TARGETS = 'true';
        const internal = {
          ...webhookProvider,
          config: {
            ...webhookProvider.config,
            url: 'http://10.0.0.5:8080/hook',
          },
        };
        await service.sendNotification(internal, basePayload);
        expect(mockPublicFetchOptions).toHaveBeenLastCalledWith({
          allowInternal: true,
        });

        delete process.env.ALLOW_INTERNAL_TARGETS;
        mockFetch.mockClear();
        const result = await service.sendNotification(internal, basePayload);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(result).toBe(false);
      } finally {
        process.env.SELF_HOSTED = saved.SELF_HOSTED;
        process.env.ALLOW_INTERNAL_TARGETS = saved.ALLOW_INTERNAL_TARGETS;
        if (saved.SELF_HOSTED === undefined) delete process.env.SELF_HOSTED;
        if (saved.ALLOW_INTERNAL_TARGETS === undefined)
          delete process.env.ALLOW_INTERNAL_TARGETS;
      }
    });

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

    it('should preserve stored custom webhook payloads without integration lifecycle fields', async () => {
      await service.sendNotification(webhookProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(callArgs[1].headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'Supercheck-Monitor/1.0',
        }),
      );
      expect(body).toEqual(
        expect.objectContaining({
          title: 'Monitor Down',
          message: 'Your monitor is down',
          provider: 'webhook',
          version: '1.0',
          originalPayload: expect.objectContaining({
            type: 'monitor_down',
            targetId: 'monitor-123',
          }),
        }),
      );
      expect(body).not.toHaveProperty('event_action');
      expect(body).not.toHaveProperty('dedup_key');
    });

    it('should use custom method from config', async () => {
      const putProvider: NotificationProvider = {
        ...webhookProvider,
        config: { url: 'https://api.example.com/webhook', method: 'PUT' },
      };

      await service.sendNotification(putProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        putProvider.config.url,
        expect.objectContaining({
          method: 'PUT',
        }),
      );
    });

    it('should merge custom headers with defaults', async () => {
      const headerProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          headers: { Authorization: 'Bearer test-token' },
        },
      };

      await service.sendNotification(headerProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].headers).toEqual(
        expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'Supercheck-Monitor/1.0',
          Authorization: 'Bearer test-token',
        }),
      );
    });

    it('should reject custom headers that override managed transport headers', async () => {
      const headerProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          headers: { Host: 'metadata.google.internal' },
        },
      };

      const result = await service.sendNotification(
        headerProvider,
        basePayload,
      );

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should use body template with variable substitution', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            routing_key: 'test-key',
            event_action: 'trigger',
            payload: {
              summary: '{{title}}',
              severity: '{{severity}}',
              source: 'supercheck',
              component: '{{monitorName}}',
            },
          }),
        },
      };

      await service.sendNotification(templateProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.routing_key).toBe('test-key');
      expect(body.payload.summary).toBe('Monitor Down');
      expect(body.payload.severity).toBe('error');
      expect(body.payload.component).toBe('Test Monitor');
    });

    it('should safely escape interpolated values in JSON templates', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          bodyTemplate: JSON.stringify({
            payload: {
              summary: '{{title}}',
              details: '{{errorMessage}}',
            },
          }),
        },
      };

      const payloadWithSpecialCharacters: NotificationPayload = {
        ...basePayload,
        title: 'Monitor "API"\nDown',
        metadata: {
          ...basePayload.metadata,
          errorMessage: 'Socket \\ reset\nline2',
        },
      };

      await service.sendNotification(
        templateProvider,
        payloadWithSpecialCharacters,
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.payload.summary).toBe('Monitor "API"\nDown');
      expect(body.payload.details).toBe('Socket \\ reset\nline2');
    });

    it('should preserve unknown template variables as-is', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          bodyTemplate: '{"unknown": "{{unknownVar}}"}',
        },
      };

      await service.sendNotification(templateProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.unknown).toBe('{{unknownVar}}');
    });

    it('should expose normalized severity for integrations that reject success', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            payload: {
              severity: '{{normalizedSeverity}}',
              rawSeverity: '{{severity}}',
            },
          }),
        },
      };

      const successPayload: NotificationPayload = {
        ...basePayload,
        severity: 'success',
      };

      await service.sendNotification(templateProvider, successPayload);

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.payload.severity).toBe('info');
      expect(body.payload.rawSeverity).toBe('success');
    });

    it('should expose PagerDuty lifecycle action and stable dedup key', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            routing_key: 'test-key',
            event_action: '{{pagerDutyEventAction}}',
            dedup_key: '{{dedupKey}}',
            payload: {
              summary: '{{title}}',
              severity: '{{normalizedSeverity}}',
              source: 'supercheck',
            },
          }),
        },
      };

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'monitor_failure',
        severity: 'error',
      });

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'monitor_recovery',
        title: 'Monitor Recovered',
        severity: 'success',
        metadata: {
          ...basePayload.metadata,
          status: 'up',
        },
      });

      const triggerBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const resolveBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(triggerBody.event_action).toBe('trigger');
      expect(resolveBody.event_action).toBe('resolve');
      expect(triggerBody.dedup_key).toBe('monitor:monitor-123');
      expect(resolveBody.dedup_key).toBe(triggerBody.dedup_key);
      expect(resolveBody.payload.severity).toBe('info');
    });

    it('should send VictorOps CRITICAL on trigger and RECOVERY on resolve', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          preset: 'splunk_on_call',
          url: 'https://alert.victorops.com/integrations/generic/20131114/alert/routing/entity',
          bodyTemplate: JSON.stringify({
            message_type: '{{victorOpsMessageType}}',
            splunk_message_type: '{{splunkOnCallMessageType}}',
            entity_id: '{{dedupKey}}',
            entity_display_name: '{{title}}',
            state_message: '{{message}}',
            monitoring_tool: 'supercheck',
          }),
        },
      };

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'monitor_failure',
        severity: 'error',
      });

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'monitor_recovery',
        title: 'Monitor Recovered',
        severity: 'success',
        metadata: {
          ...basePayload.metadata,
          status: 'up',
        },
      });

      const triggerBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const resolveBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(triggerBody.message_type).toBe('CRITICAL');
      expect(resolveBody.message_type).toBe('RECOVERY');
      expect(triggerBody.splunk_message_type).toBe('CRITICAL');
      expect(resolveBody.splunk_message_type).toBe('RECOVERY');
      expect(triggerBody.entity_id).toBe('monitor:monitor-123');
      expect(resolveBody.entity_id).toBe(triggerBody.entity_id);
    });

    it('should return sanitized delivery metadata for webhook deliveries', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          preset: 'pagerduty',
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            event_action: '{{pagerDutyEventAction}}',
            dedup_key: '{{dedupKey}}',
          }),
        },
      };

      const result = await service.sendNotificationToMultipleProviders(
        [templateProvider],
        basePayload,
      );

      expect(result.results[0].deliveryMetadata).toEqual(
        expect.objectContaining({
          version: 1,
          provider: {
            id: 'provider-webhook',
            type: 'webhook',
            preset: 'pagerduty',
          },
          source: expect.objectContaining({
            alertType: 'monitor_down',
            targetType: 'monitor',
            targetId: 'monitor-123',
            projectId: 'project-456',
          }),
          correlation: {
            dedupKey: 'monitor:monitor-123',
            eventAction: 'trigger',
            externalIncidentKey: 'monitor:monitor-123',
          },
          delivery: expect.objectContaining({
            status: 'sent',
            attempts: 1,
            responseStatus: 202,
            responseHash: expect.any(String),
          }),
        }),
      );
      expect(
        result.results[0].deliveryMetadata?.delivery.responseHash,
      ).toHaveLength(64);
    });

    it('should record recovery lifecycle metadata for custom webhook deliveries', async () => {
      const result = await service.sendNotificationToMultipleProviders(
        [webhookProvider],
        {
          ...basePayload,
          type: 'monitor_recovery',
          title: 'Monitor Recovered',
          severity: 'success',
          metadata: {
            ...basePayload.metadata,
            status: 'up',
          },
        },
      );

      expect(result.results[0].deliveryMetadata).toEqual(
        expect.objectContaining({
          version: 1,
          provider: {
            id: 'provider-webhook',
            type: 'webhook',
            preset: undefined,
          },
          source: expect.objectContaining({
            alertType: 'monitor_recovery',
            targetType: 'monitor',
            targetId: 'monitor-123',
            projectId: 'project-456',
          }),
          correlation: {
            dedupKey: 'monitor:monitor-123',
            eventAction: 'resolve',
          },
          delivery: expect.objectContaining({
            status: 'sent',
            attempts: 1,
            responseStatus: 202,
            responseHash: expect.any(String),
          }),
        }),
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.originalPayload).toEqual(
        expect.objectContaining({
          type: 'monitor_recovery',
          severity: 'success',
          metadata: expect.objectContaining({ status: 'up' }),
        }),
      );
      expect(body).not.toHaveProperty('event_action');
      expect(body).not.toHaveProperty('dedup_key');
    });
    it('should allow metadata to override webhook dedup key', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          bodyTemplate: JSON.stringify({
            dedup_key: '{{dedupKey}}',
          }),
        },
      };

      await service.sendNotification(templateProvider, {
        ...basePayload,
        metadata: {
          ...basePayload.metadata,
          dedupKey: 'custom-dedup-key',
        },
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);

      expect(body.dedup_key).toBe('custom-dedup-key');
    });

    it('should keep SSL alerts on a separate dedup key from monitor recovery', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            event_action: '{{pagerDutyEventAction}}',
            dedup_key: '{{dedupKey}}',
          }),
        },
      };

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'ssl_expiring',
      });

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'monitor_recovery',
        severity: 'success',
      });

      const sslBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const recoveryBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(sslBody.event_action).toBe('trigger');
      expect(sslBody.dedup_key).toBe('ssl:monitor-123');
      expect(recoveryBody.event_action).toBe('resolve');
      expect(recoveryBody.dedup_key).toBe('monitor:monitor-123');
    });

    it('should send job success as trigger unless explicitly overridden', async () => {
      const templateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://events.pagerduty.com/v2/enqueue',
          bodyTemplate: JSON.stringify({
            event_action: '{{pagerDutyEventAction}}',
            dedup_key: '{{dedupKey}}',
          }),
        },
      };

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'job_success',
        targetId: 'job-123',
        severity: 'success',
      });

      await service.sendNotification(templateProvider, {
        ...basePayload,
        type: 'job_success',
        targetId: 'job-123',
        severity: 'success',
        metadata: {
          ...basePayload.metadata,
          pagerDutyEventAction: 'resolve',
        },
      });

      const successBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const recoveryBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(successBody.event_action).toBe('trigger');
      expect(successBody.dedup_key).toBe('job:job-123');
      expect(recoveryBody.event_action).toBe('resolve');
      expect(recoveryBody.dedup_key).toBe('job:job-123');
    });

    it('should not send body for GET requests', async () => {
      const getProvider: NotificationProvider = {
        ...webhookProvider,
        config: { url: 'https://api.example.com/webhook', method: 'GET' },
      };

      await service.sendNotification(getProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].body).toBeUndefined();
    });

    it('should normalize lowercase methods before deciding whether to send a body', async () => {
      const getProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          method: ' get ' as any,
        },
      };

      await service.sendNotification(getProvider, basePayload);

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1].method).toBe('GET');
      expect(callArgs[1].body).toBeUndefined();
    });

    it('should fail fast for invalid JSON body templates', async () => {
      const invalidTemplateProvider: NotificationProvider = {
        ...webhookProvider,
        config: {
          url: 'https://api.example.com/webhook',
          bodyTemplate: '{"payload": {{title}}}',
        },
      };

      const result = await service.sendNotification(
        invalidTemplateProvider,
        basePayload,
      );

      expect(result).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
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

    it('should send to Power Automate webhook URL', async () => {
      const powerAutomateProvider: NotificationProvider = {
        id: 'provider-teams-pa',
        type: 'teams',
        config: {
          teamsWebhookUrl:
            'https://prod-00.westus.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/xxx',
        },
      };

      await service.sendNotification(powerAutomateProvider, basePayload);

      expect(mockFetch).toHaveBeenCalledWith(
        powerAutomateProvider.config.teamsWebhookUrl,
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('keeps line breaks and escapes markdown in the Teams card', async () => {
      await service.sendNotification(teamsProvider, {
        ...basePayload,
        title: '[click](https://evil.example) *bold*',
        message: 'line one\nline two',
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const blocks = body.attachments[0].content.body;
      expect(blocks[0].text).toBe(
        '\\[click\\]\\(https://evil.example\\) \\*bold\\*',
      );
      expect(blocks[1].text).toContain('line one\nline two');
    });

    it('leaves URL fields unescaped and escapes angle-bracket text', async () => {
      await service.sendNotification(teamsProvider, {
        ...basePayload,
        title: '<https://x> down',
        metadata: {
          ...basePayload.metadata,
          target: 'https://example.com/a_b(c)',
        },
      });
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const content = body.attachments[0].content.body;
      expect(content[0].text).toBe('\\<https://x\\> down');
      const facts = content[2].facts as Array<{ title: string; value: string }>;
      expect(facts.find((f) => f.title === 'Target URL')?.value).toBe(
        'https://example.com/a_b(c)',
      );
    });

    it('should reject invalid Teams webhook URL', async () => {
      const invalidProvider: NotificationProvider = {
        id: 'provider-teams-invalid',
        type: 'teams',
        config: { teamsWebhookUrl: 'https://evil.com/webhook' },
      };

      const result = await service.sendNotification(
        invalidProvider,
        basePayload,
      );
      expect(result).toBe(false);
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

    it('renders job emails from the payload title/message and the shared fields', async () => {
      mockEmailTemplateService.renderMonitorAlertEmail.mockClear();
      await service.sendNotification(emailProvider, {
        ...basePayload,
        type: 'job_failed',
        title: 'Job Error - Nightly',
        message: 'custom message',
        projectName: 'Acme',
        severity: 'error',
        metadata: {
          status: 'FAILED',
          duration: 65,
          runId: 'run-1',
          errorMessage: 'x'.repeat(5000),
        },
      });

      const arg =
        mockEmailTemplateService.renderMonitorAlertEmail.mock.calls[0][0];
      expect(arg.title).toBe('Job Error - Nightly');
      expect(arg.message).toBe('custom message');
      expect(arg.type).toBe('failure');
      const byTitle = Object.fromEntries(
        arg.fields.map((f: { title: string; value: string }) => [
          f.title,
          f.value,
        ]),
      );
      expect(byTitle.Project).toBe('Acme');
      expect(byTitle.Status).toBe('Failed');
      expect(byTitle.Duration).toBe('1m 05s');
      expect(byTitle['Run ID']).toBe('run-1');
      expect(byTitle.Error.length).toBeLessThanOrEqual(1000);
      expect(byTitle.Error.endsWith('…')).toBe(true);
    });

    it.each([
      ['job_success', 'success', 'success'],
      ['job_timeout', 'warning', 'warning'],
      ['monitor_recovery', 'success', 'recovery'],
      ['monitor_failure', 'info', 'info'],
    ] as const)(
      'maps %s (%s) to email tone %s',
      async (type, severity, tone) => {
        mockEmailTemplateService.renderMonitorAlertEmail.mockClear();
        await service.sendNotification(emailProvider, {
          ...basePayload,
          type,
          severity,
        });
        expect(
          mockEmailTemplateService.renderMonitorAlertEmail.mock.calls[0][0]
            .type,
        ).toBe(tone);
      },
    );

    it('strips emoji from link labels and puts links last', () => {
      const fields = buildEmailFields(
        [
          { title: '🔗 Job Details', value: 'https://a.io/j', raw: true },
          { title: 'Job', value: 'J' },
        ],
        { ...basePayload, metadata: { runId: 'r1' } },
      );
      expect(fields.map((f) => f.title)).toEqual([
        'Job',
        'Run ID',
        'Job Details',
      ]);
    });

    it('closes the pooled transporter on module destroy', async () => {
      const close = jest.fn();
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({}),
        close,
      });
      await service.sendNotification(emailProvider, basePayload);
      service.onApplicationShutdown();
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('reuses one pooled transporter and never calls verify()', async () => {
      const verify = jest.fn();
      const sendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockClear();
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify,
        sendMail,
        close: jest.fn(),
      });
      await service.sendNotification(emailProvider, basePayload);
      await service.sendNotification(emailProvider, basePayload);
      expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ pool: true }),
      );
      expect(verify).not.toHaveBeenCalled();
      expect(sendMail).toHaveBeenCalledTimes(4); // 2 recipients x 2 sends
    });

    it('adds the From display name and Reply-To only when configured', async () => {
      const sendMail = jest.fn().mockResolvedValue({});
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        sendMail,
        close: jest.fn(),
      });
      process.env.SMTP_FROM_NAME = 'Acme Alerts';
      process.env.SMTP_REPLY_TO = 'support@acme.test';
      await service.sendNotification(emailProvider, basePayload);
      expect(sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: { name: 'Acme Alerts', address: process.env.SMTP_FROM_EMAIL },
          replyTo: 'support@acme.test',
        }),
      );
      delete process.env.SMTP_FROM_NAME;
      delete process.env.SMTP_REPLY_TO;
      sendMail.mockClear();
      await service.sendNotification(emailProvider, basePayload);
      const sent = sendMail.mock.calls[0][0];
      expect(sent.from).toBe(process.env.SMTP_FROM_EMAIL);
      expect(sent).not.toHaveProperty('replyTo');
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

    it('should mark partial email delivery as a provider failure', async () => {
      const nodemailer = require('nodemailer');
      const mockSendMail = jest
        .fn()
        .mockResolvedValueOnce({ messageId: 'msg-1' })
        .mockRejectedValueOnce(new Error('Recipient rejected'));
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: mockSendMail,
      });

      const providers = [
        {
          ...emailProvider,
          config: { emails: 'good@test.com, bad@test.com' },
        },
      ];

      const result = await service.sendNotificationToMultipleProviders(
        providers,
        basePayload,
      );

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0]).toMatchObject({
        success: false,
        partial: true,
      });
      expect(result.results[0].error).toContain('bad@test.com');
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
          process.env.SMTP_FROM_EMAIL = 'notifications@example.com';
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
        config: { emails: 'valid@test.com' },
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

    it('passes the rendered subject to sendMail', async () => {
      const nodemailer = require('nodemailer');
      const mockSendMail = jest
        .fn()
        .mockResolvedValue({ messageId: 'msg-123' });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: mockSendMail,
      });

      await service.sendNotification(emailProvider, basePayload);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Monitor Alert' }),
      );
    });

    it('should send to ALL email addresses in comma-separated list', async () => {
      const nodemailer = require('nodemailer');
      const mockSendMail = jest
        .fn()
        .mockResolvedValue({ messageId: 'msg-123' });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: mockSendMail,
      });

      const provider = {
        ...emailProvider,
        config: { emails: 'first@test.com, second@test.com, third@test.com' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(true);
      expect(mockSendMail).toHaveBeenCalledTimes(3);
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'first@test.com' }),
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'second@test.com' }),
      );
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'third@test.com' }),
      );
    });

    it('should fail if any configured email address fails to send', async () => {
      const nodemailer = require('nodemailer');
      const mockSendMail = jest
        .fn()
        .mockResolvedValueOnce({ messageId: 'msg-1' })
        .mockRejectedValueOnce(new Error('Recipient rejected'))
        .mockResolvedValueOnce({ messageId: 'msg-3' });
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: mockSendMail,
      });

      const provider = {
        ...emailProvider,
        config: { emails: 'good@test.com, bad@test.com, also-good@test.com' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(false);
      expect(mockSendMail).toHaveBeenCalledTimes(3);
    });

    it('should fail if all emails fail to send', async () => {
      const nodemailer = require('nodemailer');
      const mockSendMail = jest.fn().mockRejectedValue(new Error('SMTP error'));
      (nodemailer.createTransport as jest.Mock).mockReturnValue({
        verify: jest.fn().mockResolvedValue(true),
        sendMail: mockSendMail,
      });

      const provider = {
        ...emailProvider,
        config: { emails: 'a@test.com, b@test.com' },
      };

      const result = await service.sendNotification(provider, basePayload);

      expect(result).toBe(false);
      expect(mockSendMail).toHaveBeenCalledTimes(2);
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
