/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
  getActiveOrganization: jest.fn(),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  getUserRole: jest.fn(),
  getUserOrgRole: jest.fn(),
}));

import { requireAdmin, AdminAccessDeniedError, adminDeniedResponse } from "./admin";

const { getCurrentUser } = jest.requireMock("@/lib/session") as { getCurrentUser: jest.Mock };
const { getUserRole } = jest.requireMock("@/lib/rbac/middleware") as { getUserRole: jest.Mock };

describe("requireAdmin", () => {
  beforeEach(() => jest.clearAllMocks());

  it("throws a 401 denial for anonymous callers", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 });
  });

  it("throws a 403 denial for authenticated non-admins", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getUserRole.mockResolvedValue("org_owner");
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
  });

  it("resolves the session user once and reads a failed role lookup as a 403", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getUserRole.mockRejectedValue(new Error("db down"));
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 });
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it("checks a supplied user id without reading the session", async () => {
    getUserRole.mockResolvedValue("super_admin");
    await expect(requireAdmin("u9")).resolves.toBeUndefined();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("allows super admins", async () => {
    getCurrentUser.mockResolvedValue({ id: "u1" });
    getUserRole.mockResolvedValue("super_admin");
    await expect(requireAdmin()).resolves.toBeUndefined();
  });
});

describe("adminDeniedResponse", () => {
  it("maps denials to their status and ignores other errors", async () => {
    expect(adminDeniedResponse(new AdminAccessDeniedError(401))?.status).toBe(401);
    expect(adminDeniedResponse(new AdminAccessDeniedError())?.status).toBe(403);
    expect(adminDeniedResponse(new Error("boom"))).toBeNull();
  });
});
