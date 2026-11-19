import {
  getSensitiveFieldsForProviderType,
  mergeNotificationProviderConfig,
  sanitizeConfigForClient,
} from "./crypto";
import type { NotificationProviderType, PlainNotificationProviderConfig } from "@/db/schema";

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
        method: "POST" as const,
        bodyTemplate: '{"old":"template"}',
      };
      const incoming = {
        name: "VictorOps",
        method: "POST" as const,
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
        method: "POST" as const,
      };
      const incoming = {
        name: "VictorOps",
        url: "https://alert.victorops.com/new",
        method: "POST" as const,
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
        method: "GET" as const,
        bodyTemplate: '{"old":"value"}',
      };
      const incoming = {
        name: "Webhook",
        url: "https://example.com/webhook",
        method: "POST" as const,
        bodyTemplate: '{"new":"value"}',
      };

      const merged = mergeNotificationProviderConfig("webhook", existing, incoming);

      expect(merged.method).toBe("POST");
      expect(merged.bodyTemplate).toBe('{"new":"value"}');
    });

    describe("webhook credentials follow their endpoint", () => {
      const existing = {
        name: "W",
        preset: "incident_io" as const,
        url: "https://api.incident.io/v2/alert_events/http/abc",
        headers: { Authorization: "Bearer real" },
      };

      const retargetError = "Enter the webhook headers again";

      it("refuses to carry stored headers to another host", () => {
        expect(() =>
          mergeNotificationProviderConfig("webhook", existing, { name: "W", url: "https://other.example.com/x" })
        ).toThrow(retargetError);
      });

      it("refuses another path on the same host, which may belong to someone else, but keeps an equivalent URL", () => {
        expect(() =>
          mergeNotificationProviderConfig("webhook", existing, { name: "W", url: "https://api.incident.io/v2/alert_events/http/def" })
        ).toThrow(retargetError);
        const merged = mergeNotificationProviderConfig("webhook", existing, {
          name: "W",
          url: "HTTPS://API.INCIDENT.IO:443/v2/alert_events/http/abc",
        });
        expect(merged.headers).toEqual(existing.headers);
      });

      it("treats a URL sent as a non-string as another host", () => {
        const url = ["https://api.incident.io/v2/alert_events/http/abc"] as unknown as string;
        expect(() => mergeNotificationProviderConfig("webhook", existing, { name: "W", url })).toThrow(retargetError);
      });

      it("refuses a preset change that would keep the stored headers, and drops the old URL", () => {
        expect(() => mergeNotificationProviderConfig("webhook", existing, { name: "W", preset: "custom" })).toThrow(
          retargetError
        );
        const merged = mergeNotificationProviderConfig("webhook", existing, { name: "W", preset: "custom", headers: {} });
        expect(merged.url).toBeUndefined();
        expect(merged.headers).toEqual({});
      });

      it("allows retargeting a channel that has no stored headers", () => {
        const bare = { name: "W", url: "https://a.example.com/x" };
        expect(mergeNotificationProviderConfig("webhook", bare, { name: "W", url: "https://b.example.com/y" }).url).toBe(
          "https://b.example.com/y"
        );
      });

      it("keeps headers that are sent, and keeps stored ones when the endpoint is unchanged", () => {
        expect(mergeNotificationProviderConfig("webhook", existing, { name: "W", url: "https://other.example.com/x", headers: { A: "b" } }).headers).toEqual({ A: "b" });
        const same = mergeNotificationProviderConfig("webhook", existing, { name: "W", preset: "incident_io", url: existing.url });
        expect(same.headers).toEqual(existing.headers);
        expect(mergeNotificationProviderConfig("webhook", existing, { name: "W2" }).headers).toEqual(existing.headers);
      });
    });

    it("keeps existing non-sensitive fields when not overridden", () => {
      const existing = {
        name: "Webhook",
        url: "https://example.com/webhook",
        method: "POST" as const,
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
        method: "POST" as const,
      };

      const { sanitizedConfig, maskedFields } = sanitizeConfigForClient("webhook", config, { canEdit: true });

      expect(maskedFields).toContain("url");
      expect(maskedFields).toContain("headers");
      expect(sanitizedConfig.url).not.toBe("https://example.com/secret-webhook");
      expect(sanitizedConfig.url).toMatch(/\*+/);
      expect(sanitizedConfig.headers).toEqual({});
      expect(sanitizedConfig.method).toBe("POST");
    });

    it("withholds the webhook body template from callers who cannot edit the channel", () => {
      const config = { url: "https://events.pagerduty.com/v2/enqueue", bodyTemplate: '{"routing_key":"R0UT1NGKEY"}' };
      const viewer = sanitizeConfigForClient("webhook", config, { canEdit: false });
      expect(viewer.sanitizedConfig.bodyTemplate).toBeUndefined();
      expect(viewer.maskedFields).toContain("bodyTemplate");
      expect(JSON.stringify(viewer)).not.toContain("R0UT1NGKEY");
      const editor = sanitizeConfigForClient("webhook", config, { canEdit: true });
      expect(editor.sanitizedConfig.bodyTemplate).toBe(config.bodyTemplate);
      expect(editor.maskedFields).not.toContain("bodyTemplate");
    });

    it("masks stale secret fields even when they do not belong to the current provider type", () => {
      const config = {
        name: "Slack",
        webhookUrl: "https://hooks.slack.com/secret",
        url: "https://example.com/stale-webhook-secret",
        headers: { Authorization: "Bearer stale-secret" },
      };

      const { sanitizedConfig, maskedFields } = sanitizeConfigForClient("slack", config, { canEdit: true });

      expect(maskedFields).toContain("webhookUrl");
      expect(maskedFields).toContain("url");
      expect(maskedFields).toContain("headers");
      expect(sanitizedConfig.webhookUrl).toMatch(/\*+/);
      expect(sanitizedConfig.url).toMatch(/\*+/);
      expect(sanitizedConfig.headers).toEqual({});
    });
  });
});
