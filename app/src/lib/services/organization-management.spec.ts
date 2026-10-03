/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: jest.fn(), clearRequestCache: jest.fn() }));
jest.mock("@/lib/feature-flags", () => ({ isCloudHosted: jest.fn(() => true) }));
jest.mock("./organization-customer", () => ({ ensurePolarCustomerAndLink: jest.fn() }));

import { db } from "@/utils/db";
import { member, organization, session } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { getCachedAuthSession } from "@/lib/session-cache";
import { isCloudHosted } from "@/lib/feature-flags";
import { ensurePolarCustomerAndLink } from "./organization-customer";
import { createOrganization, switchOrganization } from "./organization-management";

function selectRows(rows: unknown[]) {
  const chain = {
    from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
    for: jest.fn().mockResolvedValue(rows), then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return chain;
}

describe("organization management", () => {
  const tx = {
    select: jest.fn(), insert: jest.fn(), update: jest.fn(),
  };
  const values = jest.fn();
  const set = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MAX_ORGANIZATIONS_PER_USER;
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: "owner", email: "owner@example.com", name: "Owner" });
    (getCachedAuthSession as jest.Mock).mockResolvedValue({ session: { token: "token" } });
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    (db.transaction as jest.Mock).mockImplementation(async callback => callback(tx));
    tx.select.mockReset();
    values.mockImplementation(() => ({ returning: jest.fn().mockResolvedValue([{ id: "new-id", name: "New team" }]) }));
    tx.insert.mockReturnValue({ values });
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: "session-id" }]) }) });
    tx.update.mockReturnValue({ set });
  });

  it("starts a new cloud organization without inheriting the owner's existing subscription", async () => {
    tx.select.mockReturnValueOnce(selectRows([{ emailVerified: true }]))
      .mockReturnValueOnce(selectRows([{ id: "paid-org-membership" }]));
    await expect(createOrganization("New team")).resolves.toMatchObject({ id: "new-id" });
    expect(tx.insert).toHaveBeenCalledWith(organization);
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ subscriptionPlan: null, subscriptionStatus: "none" }));
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "new-id", userId: "owner", role: "org_owner" }));
    expect(tx.insert).toHaveBeenCalledWith(member);
    expect(set).toHaveBeenCalledWith({ activeOrganizationId: "new-id", activeProjectId: "new-id" });
    expect(ensurePolarCustomerAndLink).toHaveBeenCalledWith("owner", "owner@example.com", "Owner", "new-id");
  });

  it("gives self-hosted organizations unlimited access without a provider customer", async () => {
    (isCloudHosted as jest.Mock).mockReturnValue(false);
    tx.select.mockReturnValueOnce(selectRows([{ emailVerified: false }]));
    await createOrganization("Local team");
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ subscriptionPlan: "unlimited", subscriptionStatus: "active" }));
    expect(ensurePolarCustomerAndLink).not.toHaveBeenCalled();
  });

  it("rejects an unverified cloud account before creating any rows", async () => {
    tx.select.mockReturnValueOnce(selectRows([{ emailVerified: false }]));
    await expect(createOrganization("New team")).rejects.toMatchObject({ status: 403 });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(ensurePolarCustomerAndLink).not.toHaveBeenCalled();
  });

  it("enforces an owner cap independently of plan allowances", async () => {
    process.env.MAX_ORGANIZATIONS_PER_USER = "1";
    tx.select.mockReturnValueOnce(selectRows([{ emailVerified: true }]))
      .mockReturnValueOnce(selectRows([{ id: "owned" }]));
    await expect(createOrganization("New team")).rejects.toMatchObject({ status: 409 });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("allows an invited member to switch and updates both session scopes together", async () => {
    tx.select.mockReturnValueOnce(selectRows([{ id: "membership" }]))
      .mockReturnValueOnce(selectRows([{ id: "project-b" }]));
    await expect(switchOrganization("org-b")).resolves.toEqual({ organizationId: "org-b", projectId: "project-b" });
    expect(tx.update).toHaveBeenCalledWith(session);
    expect(set).toHaveBeenCalledWith({ activeOrganizationId: "org-b", activeProjectId: "project-b" });
    expect(ensurePolarCustomerAndLink).not.toHaveBeenCalled();
  });

  it("rejects a foreign organization before changing the session", async () => {
    tx.select.mockReturnValueOnce(selectRows([]));
    await expect(switchOrganization("foreign-org")).rejects.toMatchObject({ status: 403 });
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("clears the old project when the new organization has no active projects", async () => {
    tx.select.mockReturnValueOnce(selectRows([{ id: "membership" }]))
      .mockReturnValueOnce(selectRows([]));
    await switchOrganization("empty-org");
    expect(set).toHaveBeenCalledWith({ activeOrganizationId: "empty-org", activeProjectId: null });
  });

  it("requires an interactive session even when a user has another authentication context", async () => {
    (getCachedAuthSession as jest.Mock).mockResolvedValue(null);
    await expect(switchOrganization("org-b")).rejects.toMatchObject({ status: 401 });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("does not provision a customer if updating the session fails", async () => {
    tx.select.mockReturnValueOnce(selectRows([{ emailVerified: true }]))
      .mockReturnValueOnce(selectRows([]));
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([]) }) });
    await expect(createOrganization("New team")).rejects.toMatchObject({ status: 401 });
    expect(ensurePolarCustomerAndLink).not.toHaveBeenCalled();
  });
});
