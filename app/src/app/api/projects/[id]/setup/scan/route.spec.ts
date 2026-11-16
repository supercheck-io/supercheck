/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: jest.fn(async (_org: string, message: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return NextResponse.json({ error: message }, { status: 403 });
  }),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: jest.fn(),
  resolveProjectPermissionContext: jest.fn(),
  checkPermissionWithContext: jest.fn(),
}));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSetupReadRateLimit: jest.fn(),
  checkSetupWriteRateLimit: jest.fn(),
  checkSlidingWindowRateLimit: jest.fn(),
}));
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    reason = "subscription_required";
  }
  return { SubscriptionAccessDeniedError, subscriptionService: { blockUntilSubscribed: jest.fn() } };
});
jest.mock("@/lib/setup/setup-state", () => ({ saveScanResult: jest.fn() }));
jest.mock("@/lib/setup/scan", () => ({
  enqueueScan: jest.fn(),
  readScan: jest.fn(),
  scanIdPrefix: (projectId: string) => `setup-scan:${projectId}:`,
}));

import { GET, POST } from "./route";
import { logAuditEvent } from "@/lib/audit-logger";
import { requireAuth, resolveProjectPermissionContext, checkPermissionWithContext } from "@/lib/rbac/middleware";
import { checkSetupReadRateLimit, checkSetupWriteRateLimit, checkSlidingWindowRateLimit } from "@/lib/sre/sre-rate-limiter";
import { SubscriptionAccessDeniedError, subscriptionService } from "@/lib/services/subscription-service";
import { enqueueScan, readScan } from "@/lib/setup/scan";
import { saveScanResult } from "@/lib/setup/setup-state";
import { ExecutionQueueError } from "@/lib/execution-errors";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ORG = "22222222-2222-4222-8222-222222222222";
const ctx = { userId: "u1", organizationId: ORG, orgPendingDeletion: false, project: { id: PROJECT, userRole: "project_editor" } };
const SCAN_ID = `setup-scan:${PROJECT}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

const params = (id = PROJECT) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/projects/${PROJECT}/setup/scan`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (scanId?: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/projects/${PROJECT}/setup/scan${scanId === undefined ? "" : `?scanId=${encodeURIComponent(scanId)}`}`, { headers });

const originalAllow = process.env.ALLOW_INTERNAL_TARGETS;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ALLOW_INTERNAL_TARGETS;
  (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
  (resolveProjectPermissionContext as jest.Mock).mockResolvedValue(ctx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
  (checkSetupReadRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (checkSetupWriteRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 1 });
  (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValue({ allowed: true, remaining: 5 });
  (subscriptionService.blockUntilSubscribed as jest.Mock).mockResolvedValue(undefined);
  (enqueueScan as jest.Mock).mockResolvedValue(SCAN_ID);
});
afterAll(() => {
  if (originalAllow === undefined) delete process.env.ALLOW_INTERNAL_TARGETS;
  else process.env.ALLOW_INTERNAL_TARGETS = originalAllow;
});

describe("POST setup/scan", () => {
  it("queues a scan with the URL reduced to origin and path, and audits the host only", async () => {
    const res = await POST(post({ url: "https://user:pw@93.184.216.34:8443/app?token=s3cret#frag" }), params());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ scanId: SCAN_ID });
    expect(enqueueScan).toHaveBeenCalledWith(PROJECT, "https://93.184.216.34:8443/app");
    expect(subscriptionService.blockUntilSubscribed).toHaveBeenCalledWith(ORG);
    const audit = (logAuditEvent as jest.Mock).mock.calls[0][0];
    expect(audit).toMatchObject({ action: "project_setup.scanned", metadata: { host: "93.184.216.34:8443" } });
    expect(JSON.stringify(audit)).not.toMatch(/s3cret|pw|\/app|frag/);
    expect(checkSlidingWindowRateLimit).toHaveBeenCalledWith(`setup-scan:project:${PROJECT}`, 10, 3_600_000);
    expect(checkSlidingWindowRateLimit).toHaveBeenCalledWith(`setup-scan:org:${ORG}`, 30, 3_600_000);
  });

  it.each([
    ["private IPv4", "http://10.0.0.5/"],
    ["private 192.168", "http://192.168.1.1/"],
    ["loopback", "http://127.0.0.1:3000/"],
    ["localhost", "http://localhost/"],
    ["metadata IP", "http://169.254.169.254/latest/meta-data"],
    ["metadata host", "http://metadata.google.internal/"],
  ])("rejects %s with 400 and queues nothing", async (_name, url) => {
    const res = await POST(post({ url }), params());
    expect(res.status).toBe(400);
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("ALLOW_INTERNAL_TARGETS=true allows private targets but never metadata", async () => {
    process.env.ALLOW_INTERNAL_TARGETS = "true";
    expect((await POST(post({ url: "http://10.0.0.5/" }), params())).status).toBe(202);
    expect((await POST(post({ url: "http://127.0.0.1/" }), params())).status).toBe(202);
    expect((await POST(post({ url: "http://169.254.169.254/" }), params())).status).toBe(400);
    expect((await POST(post({ url: "http://metadata.google.internal/" }), params())).status).toBe(400);
  });

  it("rejects non-http URLs, bad JSON, unknown keys and oversized bodies", async () => {
    expect((await POST(post({ url: "ftp://93.184.216.34/" }), params())).status).toBe(400);
    expect((await POST(post({ url: "not a url" }), params())).status).toBe(400);
    expect((await POST(post({ url: "http://93.184.216.34/", extra: 1 }), params())).status).toBe(400);
    expect((await POST(post("{nope"), params())).status).toBe(400);
    expect((await POST(post({ url: "http://93.184.216.34/" + "a".repeat(9000) }), params())).status).toBe(413);
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("returns 429 when the project or org limit is hit, without queueing", async () => {
    (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });
    const project = await POST(post({ url: "http://93.184.216.34/" }), params());
    expect(project.status).toBe(429);
    expect(project.headers.get("Retry-After")).toBeTruthy();

    (checkSlidingWindowRateLimit as jest.Mock)
      .mockResolvedValueOnce({ allowed: true, remaining: 1 })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, resetTime: Date.now() + 30_000 });
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(429);

    (checkSlidingWindowRateLimit as jest.Mock).mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(503);
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("denies a viewer, a bearer credential and an unauthenticated caller", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(403);
    (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
    expect((await POST(post({ url: "http://93.184.216.34/" }, { authorization: "Bearer sck_live_x" }), params())).status).toBe(401);
    (requireAuth as jest.Mock).mockRejectedValue(new Error("no session"));
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(401);
    expect(enqueueScan).not.toHaveBeenCalled();
  });

  it("returns 402 without a subscription or trial, and 503 when the queue is down", async () => {
    (subscriptionService.blockUntilSubscribed as jest.Mock).mockRejectedValue(new (SubscriptionAccessDeniedError as unknown as new (m: string) => Error)("Active subscription required"));
    const res = await POST(post({ url: "http://93.184.216.34/" }), params());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ code: "subscription_required" });
    expect(checkSlidingWindowRateLimit).not.toHaveBeenCalled();

    (subscriptionService.blockUntilSubscribed as jest.Mock).mockResolvedValue(undefined);
    (enqueueScan as jest.Mock).mockRejectedValue(new ExecutionQueueError("queue_unavailable", "down"));
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(503);
    (enqueueScan as jest.Mock).mockRejectedValue(new Error("boom"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await POST(post({ url: "http://93.184.216.34/" }), params())).status).toBe(500);
  });
});

describe("GET setup/scan", () => {
  it("returns progress for a queued or running scan", async () => {
    (readScan as jest.Mock).mockResolvedValue({ status: "running" });
    const res = await GET(get(SCAN_ID), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "running" });
    expect(saveScanResult).not.toHaveBeenCalled();
  });

  it("stores the sanitized summary in the project's setup state when done", async () => {
    const result = { finalUrl: "https://x.test/", reachable: true, pages: [] };
    (readScan as jest.Mock).mockResolvedValue({ status: "done", result, scannedAt: 1234 });
    const res = await GET(get(SCAN_ID), params());
    expect(await res.json()).toEqual({ status: "done", result, scannedAt: 1234 });
    expect(saveScanResult).toHaveBeenCalledWith(ORG, PROJECT, result, 1234);
  });

  it("does not store a failed scan, or one read by a viewer", async () => {
    const failed = { finalUrl: "https://x.test/", reachable: false, pages: [], error: "unreachable" };
    (readScan as jest.Mock).mockResolvedValue({ status: "done", result: failed });
    expect(await (await GET(get(SCAN_ID), params())).json()).toEqual({ status: "done", result: failed });
    expect(saveScanResult).not.toHaveBeenCalled();

    const good = { finalUrl: "https://x.test/", reachable: true, pages: [] };
    (readScan as jest.Mock).mockResolvedValue({ status: "done", result: good });
    (checkPermissionWithContext as jest.Mock).mockImplementation((resource: string) => resource === "project");
    const res = await GET(get(SCAN_ID), params());
    expect(await res.json()).toEqual({ status: "done", result: good });
    expect(saveScanResult).not.toHaveBeenCalled();
  });

  it("404s a scanId from another project, a missing id and an expired job", async () => {
    expect((await GET(get(`setup-scan:${OTHER}:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`), params())).status).toBe(404);
    expect((await GET(get(`monitor-us:${PROJECT}:x`), params())).status).toBe(404);
    expect((await GET(get(), params())).status).toBe(404);
    expect(readScan).not.toHaveBeenCalled();
    (readScan as jest.Mock).mockResolvedValue(null);
    expect((await GET(get(SCAN_ID), params())).status).toBe(404);
  });

  it("requires a session with project view access", async () => {
    expect((await GET(get(SCAN_ID, { authorization: "Bearer sck_live_x" }), params())).status).toBe(401);
    (requireAuth as jest.Mock).mockRejectedValue(new Error("no session"));
    expect((await GET(get(SCAN_ID), params())).status).toBe(401);
    (requireAuth as jest.Mock).mockResolvedValue({ userId: "u1" });
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await GET(get(SCAN_ID), params())).status).toBe(403);
  });

  it("maps a queue outage to 503", async () => {
    (readScan as jest.Mock).mockRejectedValue(new ExecutionQueueError("queue_unavailable", "down"));
    expect((await GET(get(SCAN_ID), params())).status).toBe(503);
  });
});
