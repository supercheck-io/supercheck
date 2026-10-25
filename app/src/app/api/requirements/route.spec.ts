/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/requirements/service", () => ({
  createRequirementWithRelations: jest.fn(),
  getRequirementDto: jest.fn(),
  restCreateRequirementSchema: jest.requireActual("zod").z.object({
    title: jest.requireActual("zod").z.string().min(1).max(500),
    testIds: jest.requireActual("zod").z.array(jest.requireActual("zod").z.string().uuid()).optional(),
  }),
  toServiceContext: (c: { userId: string; organizationId: string; project: { id: string; name: string } }) => ({
    userId: c.userId, organizationId: c.organizationId, projectId: c.project.id, projectName: c.project.name,
  }),
}));
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { createRequirementWithRelations, getRequirementDto } from "@/lib/requirements/service";
import { POST } from "./route";

const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/requirements", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("POST /api/requirements", () => {
  it("401 when unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("no auth"), { name: "AuthError" }));
    expect((await post({ title: "x" })).status).toBe(401);
  });

  it("403 when the caller lacks requirement:create", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    const res = await post({ title: "x" });
    expect(res.status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("requirement", "create", authCtx);
    expect(createRequirementWithRelations).not.toHaveBeenCalled();
  });

  it("400 on an invalid body", async () => {
    expect((await post({ title: "" })).status).toBe(400);
    expect(createRequirementWithRelations).not.toHaveBeenCalled();
  });

  it("400 when the service rejects cross-project testIds", async () => {
    (createRequirementWithRelations as jest.Mock).mockResolvedValue({ id: "", success: false, error: "tests invalid", code: "invalid" });
    const res = await post({ title: "x", testIds: ["11111111-1111-4111-8111-111111111111"] });
    expect(res.status).toBe(400);
  });

  it("201 with the created requirement scoped to the caller's project", async () => {
    (createRequirementWithRelations as jest.Mock).mockResolvedValue({ id: "r1", success: true });
    (getRequirementDto as jest.Mock).mockResolvedValue({ id: "r1", title: "x" });
    const res = await post({ title: "x" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ requirement: { id: "r1", title: "x" } });
    expect(createRequirementWithRelations).toHaveBeenCalledWith(
      { userId: "u", organizationId: "o", projectId: "p", projectName: "P" },
      expect.objectContaining({ title: "x" })
    );
  });
});
