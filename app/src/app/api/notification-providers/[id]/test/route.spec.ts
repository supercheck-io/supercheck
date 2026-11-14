/** @jest-environment node */
import { NextRequest } from "next/server";

class MockAuthError extends Error { constructor(message: string, public status: 401 | 403 = 401) { super(message); } }
const PROVIDER = "019a0000-0000-7000-8000-0000000000a1";
let mockAuth: () => Promise<unknown>;
const context = (role: string, extra: Record<string, unknown> = {}) => async () => ({
  userId: "user-1", organizationId: "org-1", orgPendingDeletion: false, isCliAuth: false, project: { id: "proj-1", userRole: role }, ...extra,
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: () => mockAuth(),
  isAuthError: (e: unknown) => e instanceof MockAuthError,
  authErrorStatus: (e: MockAuthError) => e.status,
}));
const whereArgs: unknown[] = [];
let mockProviders: unknown[] = [];
jest.mock("@/utils/db", () => ({
  db: { select: () => ({ from: () => ({ where: (w: unknown) => { whereArgs.push(w); return { limit: async () => mockProviders }; } }) }) },
}));
jest.mock("@/lib/notification-providers/crypto", () => ({ decryptNotificationProviderConfig: (config: unknown) => config }));
const logAuditEvent = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => logAuditEvent(...a) }));
const checkAndIncrement = jest.fn();
jest.mock("@/lib/api-key-rate-limiter", () => ({ apiKeyRateLimiter: { checkAndIncrement: (...a: unknown[]) => checkAndIncrement(...a) }, createRateLimitHeaders: () => ({}) }));
const fetchChannel = jest.fn();
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({ fetchChannelWebhookEndpoint: (...a: unknown[]) => fetchChannel(...a), fetchPublicEndpoint: jest.fn() }));
const testSlack = jest.fn();
jest.mock("@/lib/notification-providers/connection-test", () => ({
  TEST_OTHER_RATE_LIMIT: { enabled: true, timeWindow: 600, maxRequests: 20 },
  testSlackConnection: (...a: unknown[]) => testSlack(...a),
  testEmailConnection: jest.fn(), testTeamsConnection: jest.fn(), testTelegramConnection: jest.fn(), testDiscordConnection: jest.fn(),
}));
jest.mock("@/lib/deletion/org-state");
let mockInternal = false;
jest.mock("@/lib/url-validator", () => ({ ...jest.requireActual("@/lib/url-validator"), allowInternalWebhookTargets: () => mockInternal }));

import { PgDialect } from "drizzle-orm/pg-core";
import { POST } from "./route";

const send = (body?: unknown, id = PROVIDER) =>
  POST(new NextRequest(`https://example.com/api/notification-providers/${id}/test`, { method: "POST", body: body === undefined ? "" : JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const pagerduty = { id: PROVIDER, type: "webhook", projectId: "proj-1", config: { url: "https://events.pagerduty.com/v2/enqueue", preset: "pagerduty", bodyTemplate: '{"event_action":"{{pagerDutyEventAction}}","dedup_key":"{{dedupKey}}","payload":{"severity":"{{normalizedSeverity}}"}}', headers: { "X-Key": "secret-integration-key" } } };
const opsgenie = { id: PROVIDER, type: "webhook", projectId: "proj-1", config: { url: "https://api.eu.opsgenie.com/v2/alerts", preset: "opsgenie", bodyTemplate: '{"alias":"{{dedupKey}}"}', headers: { Authorization: "GenieKey k" } } };
const response = (status: number, body = "") => ({ ok: status < 300, status, statusText: status === 202 ? "Accepted" : "Error", text: async () => body });

beforeEach(() => {
  jest.clearAllMocks();
  whereArgs.length = 0;
  mockAuth = context("project_editor");
  mockProviders = [pagerduty];
  checkAndIncrement.mockResolvedValue({ allowed: true });
  fetchChannel.mockResolvedValue(response(202, '{"status":"success"}'));
});

describe("POST /api/notification-providers/[id]/test (A20)", () => {
  it("lets an editor send a test page with the test dedup key and the preset's fixes, and audits it", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, action: "trigger", responseStatus: 202, dedupKey: `test:${PROVIDER}`, responseExcerpt: '{"status":"success"}' });
    const [url, init] = fetchChannel.mock.calls[0];
    expect(url).toBe("https://events.pagerduty.com/v2/enqueue");
    expect(JSON.parse(init.body)).toEqual({ event_action: "trigger", dedup_key: `test:${PROVIDER}`, payload: { severity: "critical" } });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "notification_provider_test_sent", resourceId: PROVIDER, success: true }));
    // The integration key never comes back.
    expect(JSON.stringify(body)).not.toContain("secret-integration-key");
  });

  it("resolves the test page; Opsgenie closes by alias on the configured host", async () => {
    mockProviders = [opsgenie];
    const body = await (await send({ action: "resolve" })).json();
    expect(body).toMatchObject({ ok: true, action: "resolve" });
    const [url, init] = fetchChannel.mock.calls[0];
    expect(url).toBe(`https://api.eu.opsgenie.com/v2/alerts/${encodeURIComponent(`test:${PROVIDER}`)}/close?identifierType=alias`);
    expect(init.method).toBe("POST");
  });

  it("names the integration key on a 401", async () => {
    fetchChannel.mockResolvedValue(response(401, "unauthorized"));
    const body = await (await send()).json();
    expect(body).toMatchObject({ ok: false, responseStatus: 401, error: "Authentication rejected (HTTP 401). Check the integration key." });
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("redacts credentials in the vendor response excerpt and clips it", async () => {
    fetchChannel.mockResolvedValue(response(400, `bad token sk_live_abcdefgh12345678 ${"x".repeat(3000)}`));
    const body = await (await send()).json();
    expect(body.responseExcerpt).not.toContain("sk_live_abcdefgh12345678");
    expect(body.responseExcerpt).toMatch(/… \[truncated\]$/);
    expect(body.responseExcerpt.length).toBeLessThanOrEqual(1024 + "… [truncated]".length);
  });

  it("sends a plain test message through the type's tester for non-webhook channels", async () => {
    mockProviders = [{ id: PROVIDER, type: "slack", projectId: "proj-1", config: { webhookUrl: "https://hooks.slack.com/x" } }];
    testSlack.mockResolvedValue(new Response(JSON.stringify({ success: true, message: "Slack connection successful" })));
    expect(await (await send()).json()).toMatchObject({ ok: true, message: "Slack connection successful" });
  });

  it("denies a viewer", async () => {
    mockAuth = context("project_viewer");
    expect((await send()).status).toBe(403);
    expect(fetchChannel).not.toHaveBeenCalled();
  });

  it("denies writes in an organization pending deletion", async () => {
    mockAuth = context("org_owner", { orgPendingDeletion: true });
    expect((await send()).status).toBe(403);
    expect(fetchChannel).not.toHaveBeenCalled();
  });

  it("answers 404 for another org's or project's channel, scoping the lookup by both", async () => {
    mockProviders = [];
    expect((await send()).status).toBe(404);
    const query = new PgDialect().sqlToQuery(whereArgs[0] as never);
    expect(query.params).toEqual(expect.arrayContaining([PROVIDER, "org-1", "proj-1"]));
  });

  it("answers 404 for a malformed id without touching the database", async () => {
    expect((await send(undefined, "nope")).status).toBe(404);
    expect(whereArgs).toHaveLength(0);
  });

  it("returns 401 unauthenticated and 403 for a CLI key without access", async () => {
    mockAuth = async () => { throw new MockAuthError("Authentication required"); };
    expect((await send()).status).toBe(401);
    mockAuth = async () => { throw new MockAuthError("CLI token has no project scope", 403); };
    expect((await send()).status).toBe(403);
  });

  it("rate-limits tests per user", async () => {
    checkAndIncrement.mockResolvedValue({ allowed: false });
    expect((await send()).status).toBe(429);
    expect(checkAndIncrement).toHaveBeenCalledWith("notification-test-other:user-1", expect.objectContaining({ maxRequests: 20 }));
    expect(fetchChannel).not.toHaveBeenCalled();
  });

  it("rejects an unknown action or an oversized body", async () => {
    expect((await send({ action: "acknowledge" })).status).toBe(400);
    expect((await send({ action: "trigger", pad: "x".repeat(2000) })).status).toBe(413);
    expect((await send("not an object")).status).toBe(400);
  });
});

describe("response excerpt safety", () => {
  it("redacts the channel's own integration key and URL token when the receiver echoes them", async () => {
    mockProviders = [{ ...pagerduty, config: { ...pagerduty.config, url: "https://events.pagerduty.com/v2/enqueue/routingKeyABC123456" } }];
    fetchChannel.mockResolvedValue(response(400, "echo: secret-integration-key routingKeyABC123456"));
    const body = await (await send()).json();
    expect(body.responseExcerpt).not.toContain("secret-integration-key");
    expect(body.responseExcerpt).not.toContain("routingKeyABC123456");
    expect(body.responseExcerpt).toContain("[redacted]");
  });

  it("returns no excerpt when internal webhook targets are allowed", async () => {
    mockInternal = true;
    const body = await (await send()).json();
    expect(body).toMatchObject({ ok: true, responseStatus: 202 });
    expect(body).not.toHaveProperty("responseExcerpt");
    mockInternal = false;
  });
});
