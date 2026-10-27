/** @jest-environment node */
import { NextRequest } from "next/server";

const mockRequireAuthContext = jest.fn();
const mockImpersonated = jest.fn();
const mockCheckPermission = jest.fn();

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => mockRequireAuthContext(...a),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCheckPermission(...a),
  isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a),
}));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), insert: jest.fn(), query: {} } }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/pino-config", () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }));

import { GET, POST } from "./route";
import { db } from "@/utils/db";

const JOB = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const post = () =>
  POST(
    new NextRequest(`https://app.example.com/api/jobs/${JOB}/api-keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ci" }),
    }),
    { params: Promise.resolve({ id: JOB }) },
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckPermission.mockReturnValue(true);
  mockImpersonated.mockResolvedValue(false);
});

describe("POST /api/jobs/[id]/api-keys impersonation guard", () => {
  it("refuses to mint a trigger key while a super admin is impersonating", async () => {
    mockRequireAuthContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: "p1" }, isCliAuth: false });
    mockImpersonated.mockResolvedValue(true);
    const res = await post();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/impersonating/);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not consult the session state for a CLI-token request (the key belongs to the bearer's owner)", async () => {
    mockRequireAuthContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: "p1" }, isCliAuth: true });
    mockImpersonated.mockResolvedValue(true);
    const res = await post();
    // The impersonation check is skipped for bearer-token requests; whatever else happens, it is not that refusal.
    expect(mockImpersonated).not.toHaveBeenCalled();
    const body = await res.json().catch(() => ({}));
    expect(String(body.error ?? "")).not.toMatch(/impersonating/);
  });
});

describe("GET /api/jobs/[id]/api-keys", () => {
  it("returns the creator's avatar alongside the name", async () => {
    mockRequireAuthContext.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: "p1" }, isCliAuth: false });
    const jobQuery = { from: () => jobQuery, where: () => jobQuery, limit: async () => [{ id: JOB, organizationId: "o1", projectId: "p1" }] };
    const keyQuery = {
      from: () => keyQuery,
      leftJoin: () => keyQuery,
      where: () => keyQuery,
      orderBy: async () => [
        { id: "k1", name: "ci", start: "job_ab", enabled: true, createdAt: new Date(), expiresAt: null, jobId: JOB, lastRequest: null, createdByName: "Ada", createdByImage: "/api/users/u1/avatar?v=x" },
        { id: "k2", name: "old", start: "job_cd", enabled: true, createdAt: new Date(), expiresAt: null, jobId: JOB, lastRequest: null, createdByName: null, createdByImage: null },
      ],
    };
    (db.select as jest.Mock).mockReturnValueOnce(jobQuery).mockReturnValueOnce(keyQuery);

    const res = await GET(new NextRequest(`https://app.example.com/api/jobs/${JOB}/api-keys`), { params: Promise.resolve({ id: JOB }) });
    const body = await res.json();
    expect(body.apiKeys.map((k: Record<string, unknown>) => [k.createdByName, k.createdByImage])).toEqual([
      ["Ada", "/api/users/u1/avatar?v=x"],
      ["-", null],
    ]);
  });
});
