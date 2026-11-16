/** @jest-environment node */

const mockSelect = jest.fn();

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  PROJECT_MISMATCH_MESSAGE: "Project changed",
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/utils/db", () => ({
  db: { select: (...a: unknown[]) => mockSelect(...a) },
}));

import { getSreServices } from "./sre-services";

describe("getSreServices expected project", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects before reading when the active project is not the expected one", async () => {
    const result = await getSreServices("other-project");
    expect(result).toEqual({ success: false, error: "Project changed", services: [] });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("reads the active project's services when it matches", async () => {
    mockSelect.mockReturnValue({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) });
    expect(await getSreServices("p1")).toEqual({ success: true, services: [] });
  });
});
