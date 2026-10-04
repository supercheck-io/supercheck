/** @jest-environment node */

import { NextRequest } from "next/server";

const mockPolarGetExternal = jest.fn();
const mockPolarUpdateExternal = jest.fn();
const mockPolarCreate = jest.fn();

jest.mock("@polar-sh/sdk", () => ({
  Polar: jest.fn().mockImplementation(() => ({
    customers: {
      getExternal: mockPolarGetExternal,
      list: jest.fn(),
      create: mockPolarCreate,
      update: jest.fn(),
      updateExternal: mockPolarUpdateExternal,
    },
  })),
}));

jest.mock("@/utils/db", () => ({
  db: {
    query: { organization: { findFirst: jest.fn() } },
    select: jest.fn(),
    update: jest.fn(),
    transaction: jest.fn(),
  },
}));

jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
}));

jest.mock("@/utils/auth", () => ({
  auth: { api: { getSession: jest.fn() } },
}));

jest.mock("next/headers", () => ({
  headers: jest.fn(),
}));

jest.mock("@/lib/feature-flags", () => ({
  isCloudHosted: jest.fn(() => true),
  isPolarEnabled: jest.fn(() => true),
  getPolarConfig: jest.fn(() => ({
    accessToken: "polar_test_token",
    server: "sandbox",
  })),
}));

import { getCurrentUser } from "@/lib/session";
import { auth } from "@/utils/auth";
import { db } from "@/utils/db";
import { isCloudHosted } from "@/lib/feature-flags";
import { POST } from "./route";

const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  transaction: jest.Mock;
};
const mockGetCurrentUser = getCurrentUser as jest.Mock;

function selectResult(rows: unknown[], _withLimit = false) {
  return {
    from: jest.fn().mockReturnThis(), innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockResolvedValue(rows),
    limit: jest.fn().mockResolvedValue(rows),
    then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
  };
}

function request(origin = "https://app.supercheck.io") {
  return new NextRequest("https://app.supercheck.io/api/auth/setup-defaults", {
    method: "POST",
    headers: { origin },
  });
}

describe("POST /api/auth/setup-defaults", () => {
  const updateWhere = jest.fn();
  const updateSet = jest.fn(() => ({ where: updateWhere }));

  beforeEach(() => {
    jest.clearAllMocks();
    (isCloudHosted as jest.Mock).mockReturnValue(true);
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner",
    });
    mockPolarGetExternal.mockResolvedValue({ id: "customer-1" });
    mockPolarUpdateExternal.mockResolvedValue({ id: "customer-1" });
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
      polarCustomerId: null,
    });
    updateWhere.mockReturnValue({
      returning: jest
        .fn()
        .mockResolvedValue([{ polarCustomerId: "customer-1" }]),
    });
    mockDb.update.mockReturnValue({ set: updateSet });
  });

  it("repairs an owned organization when a non-owner membership is returned first", async () => {
    mockDb.select
      .mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(
        selectResult([
          { organizationId: "org-invited", role: "project_viewer" },
          { organizationId: "org-owned", role: "org_owner" },
        ]),
      );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockPolarGetExternal).toHaveBeenCalledTimes(1);
    expect(mockPolarGetExternal).toHaveBeenCalledWith({
      externalId: "organization:org-owned",
    });
    expect(updateSet).toHaveBeenCalledWith({ polarCustomerId: "customer-1" });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("preserves an existing paid customer binding", async () => {
    mockDb.select
      .mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(
        selectResult([{ organizationId: "org-owned", role: "org_owner" }]),
      );
    (db.query.organization.findFirst as jest.Mock).mockResolvedValue({
      polarCustomerId: "legacy-paid-customer",
    });
    expect((await POST(request())).status).toBe(200);
    expect(mockPolarGetExternal).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("only provisions the oldest owned organization for legacy multiple owners", async () => {
    mockDb.select
      .mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(
        selectResult([
          { organizationId: "org-a", role: "org_owner" },
          { organizationId: "org-b", role: "org_owner" },
        ]),
      );
    mockPolarGetExternal.mockRejectedValue({ statusCode: 404 });
    mockPolarCreate
      .mockResolvedValueOnce({ id: "customer-a" })
      .mockResolvedValueOnce({ id: "customer-b" });
    expect((await POST(request())).status).toBe(200);
    expect(mockPolarCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        externalId: "organization:org-a",
        metadata: expect.objectContaining({
          referenceId: "org-a",
          userId: "user-1",
        }),
      }),
    );
    expect(mockPolarCreate).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ polarCustomerId: "customer-a" });
  });

  it("does not establish billing bindings for organizations the user does not own", async () => {
    mockDb.select
      .mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(
        selectResult([{ organizationId: "org-invited", role: "org_admin" }]),
      );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockPolarGetExternal).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("uses the oldest owner ID chosen under the user lock after a concurrent setup wins", async () => {
    mockDb.select.mockReset().mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) });
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ session: { token: "browser-token" } });
    const tx = {
      select: jest.fn().mockReturnValueOnce({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), for: jest.fn().mockResolvedValue([{ id: "user-1" }]) })
        .mockReturnValueOnce(selectResult([
          { organizationId: "invited", role: "project_editor" },
          { organizationId: "oldest-owned", role: "org_owner" },
          { organizationId: "newer-owned", role: "org_owner" },
        ])),
      insert: jest.fn(),
    };
    mockDb.transaction.mockImplementation(async callback => callback(tx));
    expect((await POST(request())).status).toBe(200);
    expect(mockPolarGetExternal).toHaveBeenCalledWith({ externalId: "organization:oldest-owned" });
    expect(mockPolarGetExternal).toHaveBeenCalledTimes(1);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("rejects cross-origin repair requests before reading the session", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });
  it("rejects an unverified cloud signup before creating data or contacting Polar", async () => {
    mockDb.select.mockReturnValueOnce(selectResult([{ emailVerified: false }], true));
    expect((await POST(request())).status).toBe(403);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockPolarCreate).not.toHaveBeenCalled();
  });

  it("preserves self-hosted setup without any Polar calls", async () => {
    (isCloudHosted as jest.Mock).mockReturnValue(false);
    mockDb.select.mockReturnValueOnce(selectResult([{ organizationId: "org-owned", role: "org_owner" }]));
    expect((await POST(request())).status).toBe(200);
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockPolarGetExternal).not.toHaveBeenCalled();
    expect(mockPolarCreate).not.toHaveBeenCalled();
  });

  it.each([true, false])("selects signup defaults in the creation transaction (session exists: %s)", async (sessionExists) => {
    mockDb.select.mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(selectResult([]))
      .mockReturnValueOnce({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([]) });
    (auth.api.getSession as unknown as jest.Mock).mockResolvedValue({ session: { token: "browser-token" } });
    const txSet = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue(sessionExists ? [{ id: "session" }] : []) }) });
    const values = jest.fn().mockReturnValue({ returning: jest.fn().mockResolvedValue([{ id: "new-id", name: "Default" }]) });
    const tx = {
      select: jest.fn().mockReturnValueOnce({ from: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), for: jest.fn().mockResolvedValue([{ id: "user-1" }]) })
        .mockReturnValueOnce(selectResult([])),
      insert: jest.fn().mockReturnValue({ values }),
      update: jest.fn().mockReturnValue({ set: txSet }),
    };
    mockDb.transaction.mockImplementation(async callback => callback(tx));
    const response = await POST(request());
    expect(response.status).toBe(sessionExists ? 200 : 401);
    expect(txSet).toHaveBeenCalledWith({ activeOrganizationId: "new-id", activeProjectId: "new-id" });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ subscriptionPlan: null, subscriptionStatus: "none" }));
    expect(tx.select.mock.results[0].value.for).toHaveBeenCalledWith("update");
    if (!sessionExists) expect(mockPolarGetExternal).not.toHaveBeenCalled();
  });

});
