/** @jest-environment node */
const mockGetSession = jest.fn();
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a) } } }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
const mockUpdate = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [{ id: "s1" }, { id: "s2" }] }) }),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));
jest.mock("@/db/schema", () => ({ session: { id: "id", userId: "userId", token: "token" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn(), ne: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/pino-config", () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }));
const mockImpersonated = jest.fn();
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: () => mockImpersonated() }));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const request = () =>
  new NextRequest("http://localhost/api/auth/invalidate-sessions", {
    method: "POST",
    body: JSON.stringify({ invalidateAll: true }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "u1" }, session: { token: "t1" } });
  mockImpersonated.mockResolvedValue(false);
});

describe("/api/auth/invalidate-sessions", () => {
  it("refuses POST under impersonation with 403 impersonation_not_allowed and changes nothing", async () => {
    mockImpersonated.mockResolvedValue(true);
    const res = await POST(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonation_not_allowed" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses GET under impersonation", async () => {
    mockImpersonated.mockResolvedValue(true);
    expect((await GET()).status).toBe(403);
  });

  it("still answers 401 when signed out", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mockImpersonated).not.toHaveBeenCalled();
  });
});
