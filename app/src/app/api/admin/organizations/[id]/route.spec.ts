/** @jest-environment node */
import { NextRequest } from "next/server";
import { DELETE } from "./route";
import { db } from "@/utils/db";

jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
jest.mock("@/lib/admin", () => ({ requireAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn(async () => ({ id: "admin" })) }));
jest.mock("@/lib/rbac/middleware", () => ({ isImpersonatedSession: jest.fn(async () => false) }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: jest.fn(async () => ({ allowed: true })) }));
import { isImpersonatedSession } from "@/lib/rbac/middleware";
jest.mock("@/lib/audit-logger", () => ({ logAdminEvent: jest.fn() }));
jest.mock("@/lib/deletion/organization", () => {
  class OrganizationMembershipChangedError extends Error {}
  return { OrganizationMembershipChangedError, requestOrganizationDeletion: jest.fn() };
});
import { requestOrganizationDeletion } from "@/lib/deletion/organization";
import { logAdminEvent } from "@/lib/audit-logger";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function selectRows(...results: unknown[][]) {
  const mock = jest.mocked(db.select);
  for (const rows of results) {
    const chain = { from: () => chain, where: () => chain, limit: () => Promise.resolve(rows), then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r) };
    mock.mockReturnValueOnce(chain as never);
  }
}

const del = (body: unknown = { confirmOrganizationId: ORG_ID }) =>
  DELETE(new NextRequest("http://localhost/x", { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ id: ORG_ID }) });

describe("admin organization DELETE", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses while the organization still has members", async () => {
    selectRows([{ id: ORG_ID }], [{ count: 1 }]);
    expect((await del()).status).toBe(400);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("schedules a memberless organization for deletion (never an immediate teardown) and audits it", async () => {
    selectRows([{ id: ORG_ID, name: "Acme", subscriptionId: "sub-1" }], [{ count: 0 }]);
    jest.mocked(requestOrganizationDeletion).mockResolvedValue({ status: "requested", purgeAfter: new Date("2026-12-01T00:00:00Z"), deletionId: "d", billing: "cancelled" });
    expect((await del()).status).toBe(200);
    expect(requestOrganizationDeletion).toHaveBeenCalledWith({ organizationId: ORG_ID, actorUserId: "admin", guard: { noMembers: true }, reason: "admin" });
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "organization_deletion_requested", ORG_ID, "organization", ORG_ID, expect.objectContaining({ organizationName: "Acme" }));
  });

  it("requires the organization id to be confirmed in the body", async () => {
    selectRows([{ id: ORG_ID, name: "Acme" }], [{ count: 0 }]);
    expect((await del({})).status).toBe(400);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });

  it("refuses from an impersonated session", async () => {
    jest.mocked(isImpersonatedSession).mockResolvedValueOnce(true);
    expect((await del()).status).toBe(403);
    expect(requestOrganizationDeletion).not.toHaveBeenCalled();
  });
});
