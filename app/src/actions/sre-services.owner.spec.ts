/** @jest-environment node */

const mockIsAssignable = jest.fn();
const mockInsertValues = jest.fn();
const mockUpdateSet = jest.fn();
const row = { id: "s1", name: "api", tags: [], tier: "3", status: "active", ownerUserId: null };

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/sre/incident-lifecycle", () => ({ isAssignableUser: (...a: unknown[]) => mockIsAssignable(...a) }));
jest.mock("@/utils/db", () => ({
  db: {
    query: { sreServices: { findFirst: jest.fn(async () => null) } },
    insert: () => ({ values: (v: unknown) => { mockInsertValues(v); return { returning: async () => [row] }; } }),
    update: () => ({ set: (v: unknown) => { mockUpdateSet(v); return { where: () => ({ returning: async () => [row] }) }; } }),
  },
}));

import { createSreService, updateSreService } from "./sre-services";

const owner = "018f0000-0000-7000-8000-0000000000a1";
const base = { name: "api", tier: "3" as const, status: "active" as const, tags: [] };

describe("service owner", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects an owner who is not an editor or admin of the project", async () => {
    mockIsAssignable.mockResolvedValue(false);
    const result = await createSreService({ ...base, ownerUserId: owner });
    expect(result).toMatchObject({ success: false, fieldErrors: { ownerUserId: expect.any(Array) } });
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockIsAssignable).toHaveBeenCalledWith("o1", "p1", owner);
  });

  it("writes owner_user_id on create", async () => {
    mockIsAssignable.mockResolvedValue(true);
    await createSreService({ ...base, ownerUserId: owner });
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: owner }));
  });

  it("sets, clears and leaves the owner on update", async () => {
    const { db } = jest.requireMock("@/utils/db");
    db.query.sreServices.findFirst
      .mockResolvedValueOnce({ id: "s1", name: "api" }).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "s1", name: "api" }).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "s1", name: "api" }).mockResolvedValueOnce(null);
    mockIsAssignable.mockResolvedValue(true);
    const id = "018f0000-0000-7000-8000-0000000000b1";
    await updateSreService({ ...base, id, ownerUserId: owner });
    expect(mockUpdateSet).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: owner }));
    await updateSreService({ ...base, id, ownerUserId: null });
    expect(mockUpdateSet).toHaveBeenLastCalledWith(expect.objectContaining({ ownerUserId: null }));
    await updateSreService({ ...base, id });
    expect(mockUpdateSet.mock.calls.at(-1)![0].ownerUserId).toBeUndefined();
  });
});
