import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { notificationProviders } from "@/db/schema";
import { apiKeyRateLimiter, createRateLimitHeaders } from "@/lib/api-key-rate-limiter";
import { logAuditEvent } from "@/lib/audit-logger";
import { readCappedJson } from "@/lib/http/read-capped-json";
import { redactChannelSecrets } from "@/lib/notification-providers/redact-channel";
import { authErrorStatus, isAuthError, requireAuthContext } from "@/lib/auth-context";
import { permissionDeniedResponse } from "@/lib/deletion/org-state";
import { safeText } from "@/lib/mcp/redact";
import {
  TEST_OTHER_RATE_LIMIT,
  testDiscordConnection,
  testEmailConnection,
  testSlackConnection,
  testTeamsConnection,
  testTelegramConnection,
} from "@/lib/notification-providers/connection-test";
import { decryptNotificationProviderConfig } from "@/lib/notification-providers/crypto";
import { presetOverrides, presetResolveRequest } from "@/lib/notification-providers/preset-lifecycle";
import { normalizeWebhookHeaders } from "@/lib/notification-providers/validation";
import { WEBHOOK_SAMPLE_TEMPLATE_VARIABLES } from "@/lib/notification-providers/webhook-preview";
import { normalizeWebhookMethod, renderWebhookJsonTemplate } from "@/lib/notification-providers/webhook-template";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { fetchChannelWebhookEndpoint } from "@/lib/sre/connectors/pinned-fetch";
import { isUuid } from "@/lib/uuid";
import { db } from "@/utils/db";

const bodySchema = z.object({ action: z.enum(["trigger", "resolve"]).default("trigger") }).strict();
const MAX_BODY_BYTES = 1_024;
const TIMEOUT_MS = 10_000;
const EXCERPT_CHARS = 1_024;
/** Larger vendor responses are cut off while reading, so a test can never buffer much memory. */
const MAX_RESPONSE_BYTES = 16 * 1_024;
const TEST_TITLE = "Test page from Supercheck";

type TestResult = {
  ok: boolean;
  action: "trigger" | "resolve";
  responseStatus?: number;
  responseStatusText?: string;
  responseExcerpt?: string;
  elapsedMs?: number;
  dedupKey?: string;
  message?: string;
  error?: string;
};

/**
 * Sends a test through a saved channel (decrypted server-side; the config never reaches the client). Webhooks get
 * a page with dedup key `test:<id>` that `action: "resolve"` closes, using the same preset fixes as real alerts.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const auth = await requireAuthContext();
    if (!checkPermissionWithContext("notification", "update", auth)) {
      return await permissionDeniedResponse(auth.organizationId, "Insufficient permissions to test notification providers");
    }
    if (!isUuid(id)) return NextResponse.json({ error: "Notification provider not found" }, { status: 404 });

    const read = await readCappedJson(req, MAX_BODY_BYTES);
    if (read.tooLarge) return NextResponse.json({ error: "Request body too large" }, { status: 413 });
    // A JSON object is required ({} triggers): a malformed body must never send a real page.
    const parsed = bodySchema.safeParse(read.data);
    if (!parsed.success) return NextResponse.json({ error: "Body must be a JSON object; action must be trigger or resolve" }, { status: 400 });
    const { action } = parsed.data;

    const [provider] = await db
      .select({ id: notificationProviders.id, type: notificationProviders.type, config: notificationProviders.config, projectId: notificationProviders.projectId })
      .from(notificationProviders)
      .where(and(eq(notificationProviders.id, id), eq(notificationProviders.organizationId, auth.organizationId), eq(notificationProviders.projectId, auth.project.id)))
      .limit(1);
    if (!provider) return NextResponse.json({ error: "Notification provider not found" }, { status: 404 });
    // Only webhooks have a page to close; a resolve on any other channel would just send another message.
    if (action === "resolve" && provider.type !== "webhook") {
      return NextResponse.json({ error: "Only webhook channels can resolve a test page" }, { status: 400 });
    }

    // Email has its own tighter limit inside its tester; every other outbound test is capped here.
    if (provider.type !== "email") {
      const limit = await apiKeyRateLimiter.checkAndIncrement(`notification-test-other:${auth.userId}`, TEST_OTHER_RATE_LIMIT);
      if (!limit.allowed) {
        return NextResponse.json(
          { error: "Too many connection tests. Try again later." },
          { status: limit.unavailable ? 503 : 429, headers: createRateLimitHeaders(limit) },
        );
      }
    }

    const config = decryptNotificationProviderConfig(provider.config, provider.projectId ?? undefined) as Record<string, unknown>;
    const preset = typeof config.preset === "string" ? config.preset : undefined;
    const result = provider.type === "webhook" ? await sendTestPage(provider.id, config, action) : await sendTestMessage(provider.type, config, auth);

    await logAuditEvent({
      userId: auth.userId,
      organizationId: auth.organizationId,
      action: "notification_provider_test_sent",
      resource: "notification_provider",
      resourceId: provider.id,
      metadata: { projectId: auth.project.id, type: provider.type, preset: preset ?? null, action, ok: result.ok, responseStatus: result.responseStatus ?? null },
      success: result.ok,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ error: (error as Error).message }, { status: authErrorStatus(error) });
    return NextResponse.json({ error: "Failed to send the test" }, { status: 500 });
  }
}

async function sendTestMessage(type: string, config: Record<string, unknown>, auth: { userId: string; organizationId: string }): Promise<TestResult> {
  const testers: Record<string, () => Promise<NextResponse>> = {
    email: () => testEmailConnection(config, auth),
    slack: () => testSlackConnection(config),
    telegram: () => testTelegramConnection(config),
    discord: () => testDiscordConnection(config),
    teams: () => testTeamsConnection(config),
  };
  const run = testers[type];
  if (!run) return { ok: false, action: "trigger", error: "Unsupported provider type" };
  const response = await run();
  const body = (await response.json().catch(() => ({}))) as { success?: boolean; message?: string; error?: string };
  return { ok: body.success === true, action: "trigger", message: body.message, error: body.error };
}

async function sendTestPage(providerId: string, config: Record<string, unknown>, action: "trigger" | "resolve"): Promise<TestResult> {
  const dedupKey = `test:${providerId}`;
  const url = typeof config.url === "string" ? config.url : "";
  const { allowInternalWebhookTargets, validateWebhookUrlString } = await import("@/lib/url-validator");
  const valid = validateWebhookUrlString(url, { allowInternal: allowInternalWebhookTargets() });
  if (!valid.valid) return { ok: false, action, dedupKey, error: valid.error || "Invalid webhook URL" };

  const resolve = action === "resolve";
  const variables = {
    ...WEBHOOK_SAMPLE_TEMPLATE_VARIABLES,
    title: TEST_TITLE,
    message: resolve ? "Test page resolved by Supercheck" : "Test page from Supercheck. Resolve it from the channel's test dialog.",
    status: resolve ? "up" : "down",
    severity: resolve ? "success" : "error",
    normalizedSeverity: resolve ? "info" : "error",
    type: resolve ? "monitor_recovery" : "monitor_failure",
    alertAction: action,
    eventAction: action,
    pagerDutyEventAction: action,
    victorOpsMessageType: resolve ? "RECOVERY" : "CRITICAL",
    splunkOnCallMessageType: resolve ? "RECOVERY" : "CRITICAL",
    dedupKey,
    ...presetOverrides(config.preset, action, { alertType: resolve ? "monitor_recovery" : "monitor_failure" }),
  };

  let request: { url: string; method: string; body?: string };
  try {
    const close = resolve ? presetResolveRequest(config.preset, url, dedupKey, TEST_TITLE) : null;
    if (close) {
      request = close;
    } else {
      const method = normalizeWebhookMethod(config.method);
      const template = typeof config.bodyTemplate === "string" ? config.bodyTemplate.trim() : "";
      request = {
        url,
        method,
        body: method === "GET" ? undefined : template ? renderWebhookJsonTemplate(template, variables) : JSON.stringify({ test: true, action, dedupKey, title: TEST_TITLE }),
      };
    }
  } catch {
    return { ok: false, action, dedupKey, error: "Could not build the test request from this channel's template" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    // Same SSRF-pinned fetch as real channel sends; the close URL was checked to stay on the configured host.
    const response = await fetchChannelWebhookEndpoint(request.url, {
      method: request.method,
      headers: { "Content-Type": "application/json", ...normalizeWebhookHeaders(config.headers) },
      body: request.body,
      signal: controller.signal,
    }, MAX_RESPONSE_BYTES);
    const auth = response.status === 401 || response.status === 403;
    // Internal targets would make the excerpt a way to read internal services: show status only, and skip the body.
    const internalAllowed = allowInternalWebhookTargets();
    const text = internalAllowed ? "" : await response.text().catch(() => "");
    return {
      ok: response.ok,
      action,
      dedupKey,
      responseStatus: response.status,
      // Status text is receiver-controlled too: same redaction, short.
      responseStatusText: safeText(redactChannelSecrets(response.statusText ?? "", config), 100) ?? "",
      // Redacted (generic patterns plus this channel's own header values and URL tokens) and clipped.
      ...(internalAllowed ? {} : { responseExcerpt: safeText(redactChannelSecrets(text, config), EXCERPT_CHARS) ?? "" }),
      elapsedMs: Date.now() - startedAt,
      ...(auth ? { error: `Authentication rejected (HTTP ${response.status}). Check the integration key.` } : {}),
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    const tooLarge = error instanceof Error && /exceeded \d+ bytes/.test(error.message);
    return {
      ok: false,
      action,
      dedupKey,
      elapsedMs: Date.now() - startedAt,
      error: timedOut ? "The request timed out after 10 seconds" : tooLarge ? "The receiver's response was too large to read" : "The request could not be sent",
    };
  } finally {
    clearTimeout(timeout);
  }
}

