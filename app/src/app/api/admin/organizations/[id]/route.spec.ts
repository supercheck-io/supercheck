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
jest.mock("@/lib/organization-teardown", () => {
  class BillingCancellationError extends Error {}
  class OrganizationMembershipChangedError extends Error {}
  return { BillingCancellationError, OrganizationMembershipChangedError, deleteOrganizationCompletely: jest.fn() };
});
import { BillingCancellationError, deleteOrganizationCompletely } from "@/lib/organization-teardown";
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
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it("tears down a memberless organization (projects, billing) and audits it", async () => {
    selectRows([{ id: ORG_ID, name: "Acme", subscriptionId: "sub-1" }], [{ count: 0 }]);
    jest.mocked(deleteOrganizationCompletely).mockResolvedValue({ s3Failures: 0, subscriptionCancelled: true });
    expect((await del()).status).toBe(200);
    expect(deleteOrganizationCompletely).toHaveBeenCalledWith(ORG_ID, { noMembers: true }, "admin");
    expect(logAdminEvent).toHaveBeenCalledWith("admin", "organization_deleted", ORG_ID, "organization", ORG_ID, expect.objectContaining({ organizationName: "Acme" }));
  });

  it("returns 502 and deletes nothing when the subscription cannot be cancelled", async () => {
    selectRows([{ id: ORG_ID, name: "Acme", subscriptionId: "sub-1" }], [{ count: 0 }]);
    jest.mocked(deleteOrganizationCompletely).mockRejectedValue(new BillingCancellationError("Could not cancel the subscription: down"));
    expect((await del()).status).toBe(502);
    expect(logAdminEvent).not.toHaveBeenCalledWith("admin", "organization_deleted", expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("requires the organization id to be confirmed in the body", async () => {
    selectRows([{ id: ORG_ID, name: "Acme" }], [{ count: 0 }]);
    expect((await del({})).status).toBe(400);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });

  it("refuses from an impersonated session", async () => {
    jest.mocked(isImpersonatedSession).mockResolvedValueOnce(true);
    expect((await del()).status).toBe(403);
    expect(deleteOrganizationCompletely).not.toHaveBeenCalled();
  });
});
