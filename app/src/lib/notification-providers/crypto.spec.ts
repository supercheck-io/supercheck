import {
  getSensitiveFieldsForProviderType,
  mergeNotificationProviderConfig,
  sanitizeConfigForClient,
} from "./crypto";
import type { NotificationProviderType } from "@/db/schema";

describe("notification provider crypto", () => {
  describe("getSensitiveFieldsForProviderType", () => {
    it.each([
      ["email", []],
      ["slack", ["webhookUrl"]],
      ["webhook", ["url", "headers"]],
      ["telegram", ["botToken"]],
      ["discord", ["discordWebhookUrl"]],
      ["teams", ["teamsWebhookUrl"]],
    ] as [NotificationProviderType, string[]][])(
      "returns sensitive fields for %s",
      (type, expected) => {
        const fields = getSensitiveFieldsForProviderType(type);
        for (const field of expected) {
          expect(fields).toContain(field);
        }
      }
    );
  });

  describe("mergeNotificationProviderConfig", () => {
    it("preserves omitted sensitive fields from the existing config", () => {
      const existing = {
        name: "VictorOps",
        url: "https://alert.victorops.com/secret",
        method: "POST",
        bodyTemplate: '{"old":"template"}',
      };
      const incoming = {
        name: "VictorOps",
        method: "POST",
        bodyTemplate: '{"new":"template"}',
      };

      const merged = mergeNotificationProviderConfig("webhook", existing, incoming);

      expect(merged.url).toBe("https://alert.victorops.com/secret");
      expect(merged.bodyTemplate).toBe('{"new":"template"}');
    });

    it("allows explicit updates to sensitive fields", () => {
      const existing = {
        name: "VictorOps",
        url: "https://alert.victorops.com/old",
        method: "POST",
      };
      const incoming = {
        name: "VictorOps",
        url: "https://alert.victorops.com/new",
        method: "POST",
      };

      const merged = mergeNotificationProviderConfig("webhook", existing, incoming);

      expect(merged.url).toBe("https://alert.victorops.com/new");
    });

    it("preserves omitted slack webhookUrl", () => {
      const existing = { name: "Slack", webhookUrl: "https://hooks.slack.com/secret" };
      const incoming = { name: "Slack" };

      const merged = mergeNotificationProviderConfig("slack", existing, incoming);

      expect(merged.webhookUrl).toBe("https://hooks.slack.com/secret");
    });

    it("updates overridden non-sensitive fields", () => {
      const existing = {
        name: "Webhook",
        url: "https://example.com/webhook",
        method: "GET",
        bodyTemplate: '{"old":"value"}',
      };
      const incoming = {
        name: "Webhook",
        url: "https://example.com/webhook",
        method: "POST",
        bodyTemplate: '{"new":"value"}',
      };

      const merged = mergeNotificationProviderConfig("webhook", existing, incoming);

      expect(merged.method).toBe("POST");
      expect(merged.bodyTemplate).toBe('{"new":"value"}');
    });

    it("keeps existing non-sensitive fields when not overridden", () => {
      const existing = {
        name: "Webhook",
        url: "https://example.com/webhook",
        method: "POST",
        bodyTemplate: '{"keep":"me"}',
      };
      const incoming = {
        name: "Webhook",
        url: "https://example.com/webhook",
      };

      const merged = mergeNotificationProviderConfig("webhook", existing, incoming);

      expect(merged.method).toBe("POST");
      expect(merged.bodyTemplate).toBe('{"keep":"me"}');
    });
  });

  describe("sanitizeConfigForClient", () => {
    it("masks webhook url and headers", () => {
      const config = {
        name: "Webhook",
        url: "https://example.com/secret-webhook",
        headers: { Authorization: "Bearer secret" },
        method: "POST",
      };

      const { sanitizedConfig, maskedFields } = sanitizeConfigForClient("webhook", config);

      expect(maskedFields).toContain("url");
      expect(maskedFields).toContain("headers");
      expect(sanitizedConfig.url).not.toBe("https://example.com/secret-webhook");
      expect(sanitizedConfig.url).toMatch(/\*+/);
      expect(sanitizedConfig.headers).toEqual({});
      expect(sanitizedConfig.method).toBe("POST");
    });

    it("masks stale secret fields even when they do not belong to the current provider type", () => {
      const config = {
        name: "Slack",
        webhookUrl: "https://hooks.slack.com/secret",
        url: "https://example.com/stale-webhook-secret",
        headers: { Authorization: "Bearer stale-secret" },
      };

      const { sanitizedConfig, maskedFields } = sanitizeConfigForClient("slack", config);

      expect(maskedFields).toContain("webhookUrl");
      expect(maskedFields).toContain("url");
      expect(maskedFields).toContain("headers");
      expect(sanitizedConfig.webhookUrl).toMatch(/\*+/);
      expect(sanitizedConfig.url).toMatch(/\*+/);
      expect(sanitizedConfig.headers).toEqual({});
    });
  });
});
