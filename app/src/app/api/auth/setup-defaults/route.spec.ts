/** @jest-environment node */

import { NextRequest } from "next/server";

const mockPolarGetExternal = jest.fn();
const mockPolarUpdateExternal = jest.fn();

jest.mock("@polar-sh/sdk", () => ({
  Polar: jest.fn().mockImplementation(() => ({
    customers: {
      getExternal: mockPolarGetExternal,
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateExternal: mockPolarUpdateExternal,
    },
  })),
}));

jest.mock("@/utils/db", () => ({
  db: {
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
    updateWhere.mockResolvedValue(undefined);
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
    expect(updateSet).toHaveBeenCalledWith({ polarCustomerId: "customer-1" });
    expect(updateWhere).toHaveBeenCalledTimes(1);
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not establish billing bindings for organizations the user does not own", async () => {
    mockDb.select
      .mockReturnValueOnce(selectResult([{ emailVerified: true }], true))
      .mockReturnValueOnce(
        selectResult([
          { organizationId: "org-invited", role: "org_admin" },
        ]),
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
