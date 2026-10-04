/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn(), update: jest.fn(), insert: jest.fn() } }));
jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/session-cache", () => ({ getCachedAuthSession: jest.fn() }));
jest.mock("./organization-customer", () => ({ ensurePolarCustomerAndLink: jest.fn() }));

import { db } from "@/utils/db";
import { getCurrentUser } from "@/lib/session";
import { getCachedAuthSession } from "@/lib/session-cache";
import { ensurePolarCustomerAndLink } from "./organization-customer";
import { createOrganization, switchOrganization } from "./organization-management";

describe("single organization management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: "owner" });
    (getCachedAuthSession as jest.Mock).mockResolvedValue({ session: { token: "token" } });
  });

  it.each([createOrganization, switchOrganization])("rejects organization mutations without touching data or Polar", async action => {
    await expect(action("another-organization")).rejects.toMatchObject({ status: 403 });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(ensurePolarCustomerAndLink).not.toHaveBeenCalled();
  });

  it.each([createOrganization, switchOrganization])("requires authentication", async action => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    await expect(action("another-organization")).rejects.toMatchObject({ status: 401 });
  });

  it.each([createOrganization, switchOrganization])("requires an interactive session", async action => {
    (getCachedAuthSession as jest.Mock).mockResolvedValue(null);
    await expect(action("another-organization")).rejects.toMatchObject({ status: 401 });
  });
});
