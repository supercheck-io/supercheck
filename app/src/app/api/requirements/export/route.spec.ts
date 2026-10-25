/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/requirements/service", () => ({
  exportRequirementsCsvRecord: jest.fn(),
  toServiceContext: (c: { userId: string; organizationId: string; project: { id: string; name: string } }) => ({
    userId: c.userId, organizationId: c.organizationId, projectId: c.project.id, projectName: c.project.name,
  }),
}));
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { exportRequirementsCsvRecord } from "@/lib/requirements/service";
import { GET } from "./route";

const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("GET /api/requirements/export", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await GET()).status).toBe(401);
  });
  it("403 without requirement:view", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await GET()).status).toBe(403);
    expect(exportRequirementsCsvRecord).not.toHaveBeenCalled();
  });
  it("200 returns CSV as an attachment", async () => {
    (exportRequirementsCsvRecord as jest.Mock).mockResolvedValue({ csv: "ID,Title\n1,a", filename: "f.csv", count: 1 });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="requirements.csv"');
    expect(await res.text()).toBe("ID,Title\n1,a");
    expect(exportRequirementsCsvRecord).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p" }));
  });
});
