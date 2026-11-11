/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/admin-errors", () => ({ adminDeniedResponse: jest.fn(() => null) }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "admin" })) }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
jest.mock("@/lib/deletion/reauth", () => ({ isFreshSession: jest.fn(async () => true), reauthRequiredResponse: jest.fn(() => new Response(null, { status: 403 })) }));
jest.mock("@/lib/deletion/organization", () => ({ purgeOrganizationNow: jest.fn() }));
import { requireAdmin } from "@/lib/admin";
import { adminDeniedResponse } from "@/lib/admin-errors";
import { isImpersonatedSession } from "@/lib/rbac/middleware";
import { purgeOrganizationNow } from "@/lib/deletion/organization";
import { POST } from "./route";

const ORG_ID = "267cc333-3242-5fc2-821c-51a1a17b9580";
const call = (body: unknown) => POST(new NextRequest("https://app.supercheck.io/x", { method: "POST", headers: { origin: "https://app.supercheck.io" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: ORG_ID }) });
const valid = { reason: "Legal erasure request 2026-11", confirmOrganizationId: ORG_ID };

describe("super admin early purge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (adminDeniedResponse as jest.Mock).mockReturnValue(null);
    (purgeOrganizationNow as jest.Mock).mockResolvedValue({ deletionId: "d1", wasPending: true });
  });

  it("purges with the reason handed to the audited helper", async () => {
    const response = await call(valid);
    expect(response.status).toBe(200);
    expect(purgeOrganizationNow).toHaveBeenCalledWith({ organizationId: ORG_ID, adminUserId: "admin", reason: valid.reason });
  });

  it("requires a real reason and the matching organization id", async () => {
    for (const body of [{}, null, { ...valid, reason: "short" }, { ...valid, confirmOrganizationId: "11111111-1111-4111-8111-111111111111" }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(purgeOrganizationNow).not.toHaveBeenCalled();
  });

  it("is for super admins only, never from an impersonated session", async () => {
    (requireAdmin as jest.Mock).mockRejectedValueOnce(new Error("Admin privileges required"));
    (adminDeniedResponse as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
    expect((await call(valid)).status).toBe(403);
    (isImpersonatedSession as jest.Mock).mockResolvedValueOnce(true);
    expect((await call(valid)).status).toBe(403);
    expect(purgeOrganizationNow).not.toHaveBeenCalled();
  });

  it("asks for a fresh sign-in first", async () => {
    const { isFreshSession } = jest.requireMock("@/lib/deletion/reauth");
    isFreshSession.mockResolvedValueOnce(false);
    expect((await call(valid)).status).toBe(403);
    expect(purgeOrganizationNow).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown organization", async () => {
    (purgeOrganizationNow as jest.Mock).mockResolvedValueOnce(null);
    expect((await call(valid)).status).toBe(404);
  });
});
