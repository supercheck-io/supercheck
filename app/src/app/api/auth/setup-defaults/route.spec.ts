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
import { db } from "@/utils/db";
import { POST } from "./route";

const mockDb = db as unknown as {
  select: jest.Mock;
  update: jest.Mock;
  transaction: jest.Mock;
};
const mockGetCurrentUser = getCurrentUser as jest.Mock;

function selectResult(rows: unknown[], withLimit = false) {
  const whereResult = withLimit
    ? { limit: jest.fn().mockResolvedValue(rows) }
    : Promise.resolve(rows);
  return {
    from: jest.fn(() => ({
      where: jest.fn(() => whereResult),
    })),
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

  it("creates separate external customer identities for two owned organizations", async () => {
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
    expect(mockPolarCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ externalId: "organization:org-b" }),
    );
    expect(updateSet).toHaveBeenCalledWith({ polarCustomerId: "customer-a" });
    expect(updateSet).toHaveBeenCalledWith({ polarCustomerId: "customer-b" });
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

  it("rejects cross-origin repair requests before reading the session", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
