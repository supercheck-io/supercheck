/** @jest-environment node */
import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false) }));
jest.mock("@/lib/rbac/middleware", () => ({ getUserOrgRole: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));

import { db } from "@/utils/db";
import { requireUserAuthContext } from "@/lib/auth-context";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { DELETE } from "./route";

function rows(values: unknown[]) {
  return {
    from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
    for: jest.fn().mockResolvedValue(values), then: (resolve: (result: unknown[]) => unknown) => Promise.resolve(values).then(resolve),
  };
}
const request = (origin = "https://app.supercheck.io") => new NextRequest("https://app.supercheck.io/api/organizations/org-a", { method: "DELETE", headers: { origin } });
const params = { params: Promise.resolve({ id: "org-a" }) };

describe("organization deletion", () => {
  const set = jest.fn();
  const tx = { select: jest.fn(), update: jest.fn(), delete: jest.fn() };
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "owner", isCliAuth: false });
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    (db.transaction as jest.Mock).mockImplementation(callback => callback(tx));
    tx.select.mockReset().mockReturnValueOnce(rows([{ subscriptionId: null, polarCustomerId: null }]))
      .mockReturnValueOnce(rows([{ id: "owner-membership" }])).mockReturnValueOnce(rows([]));
    set.mockReturnValue({ where: jest.fn().mockResolvedValue([]) });
    tx.update.mockReturnValue({ set });
    tx.delete.mockReturnValue({ where: jest.fn().mockResolvedValue([]) });
  });

  it("clears selected session references before deleting an empty organization", async () => {
    expect((await DELETE(request(), params)).status).toBe(200);
    expect(set).toHaveBeenCalledWith({ activeOrganizationId: null, activeProjectId: null });
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(tx.update.mock.invocationCallOrder[0]).toBeLessThan(tx.delete.mock.invocationCallOrder[0]);
  });

  it("returns a conflict for projects instead of relying on nonexistent cascades", async () => {
    tx.select.mockReset().mockReturnValueOnce(rows([{}])).mockReturnValueOnce(rows([{ id: "owner-membership" }]))
      .mockReturnValueOnce(rows([{ id: "project" }]));
    expect((await DELETE(request(), params)).status).toBe(409);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("keeps billing-linked organizations intact so a deletion cannot orphan billing", async () => {
    tx.select.mockReset().mockReturnValueOnce(rows([{ polarCustomerId: "customer" }]))
      .mockReturnValueOnce(rows([{ id: "owner-membership" }]));
    expect((await DELETE(request(), params)).status).toBe(409);
    expect(tx.delete).not.toHaveBeenCalled();
  });

  it("rejects cross-origin browser deletion and nonowners", async () => {
    expect((await DELETE(request("https://foreign.example"), params)).status).toBe(403);
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_admin");
    expect((await DELETE(request(), params)).status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("reports a related-data conflict when another foreign key prevents deletion", async () => {
    (db.transaction as jest.Mock).mockRejectedValueOnce({ cause: { code: "23503" } });
    expect((await DELETE(request(), params)).status).toBe(409);
  });
});
