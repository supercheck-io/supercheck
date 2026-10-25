/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/requirements/service", () => {
  const { z } = jest.requireActual("zod");
  return {
    deleteRequirementRecord: jest.fn(),
    getRequirementDto: jest.fn(),
    updateRequirementWithRelations: jest.fn(),
    restUpdateRequirementSchema: z.object({ title: z.string().min(1).max(500).optional() }),
    toServiceContext: (c: { userId: string; organizationId: string; project: { id: string; name: string } }) => ({
      userId: c.userId, organizationId: c.organizationId, projectId: c.project.id, projectName: c.project.name,
    }),
  };
});
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { deleteRequirementRecord, getRequirementDto, updateRequirementWithRelations } from "@/lib/requirements/service";
import { GET, PUT, DELETE } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const params = (id = ID) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/requirements/${ID}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("GET /api/requirements/[id]", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await GET(req("GET"), params())).status).toBe(401);
  });
  it("404 for a malformed id", async () => {
    expect((await GET(req("GET"), params("nope"))).status).toBe(404);
  });
  it("404 when the requirement is not in the caller's project", async () => {
    (getRequirementDto as jest.Mock).mockResolvedValue(null);
    expect((await GET(req("GET"), params())).status).toBe(404);
    expect(getRequirementDto).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", organizationId: "o" }), ID);
  });
  it("200 with the requirement", async () => {
    (getRequirementDto as jest.Mock).mockResolvedValue({ id: ID });
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requirement: { id: ID } });
  });
});

describe("PUT /api/requirements/[id]", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await PUT(req("PUT", { title: "x" }), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("requirement", "update", authCtx);
    expect(updateRequirementWithRelations).not.toHaveBeenCalled();
  });
  it("400 on an invalid body", async () => {
    expect((await PUT(req("PUT", { title: "" }), params())).status).toBe(400);
  });
  it("404 cross-project id", async () => {
    (updateRequirementWithRelations as jest.Mock).mockResolvedValue({ success: false, code: "not_found", error: "nf" });
    expect((await PUT(req("PUT", { title: "x" }), params())).status).toBe(404);
  });
  it("400 when the service rejects the testIds", async () => {
    (updateRequirementWithRelations as jest.Mock).mockResolvedValue({ success: false, code: "invalid", error: "bad" });
    expect((await PUT(req("PUT", { title: "x" }), params())).status).toBe(400);
  });
  it("200 returns the updated requirement", async () => {
    (updateRequirementWithRelations as jest.Mock).mockResolvedValue({ success: true });
    (getRequirementDto as jest.Mock).mockResolvedValue({ id: ID, title: "x" });
    const res = await PUT(req("PUT", { title: "x" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requirement: { id: ID, title: "x" } });
  });
});

describe("DELETE /api/requirements/[id]", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await DELETE(req("DELETE"), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("requirement", "delete", authCtx);
  });
  it("404 cross-project id", async () => {
    (deleteRequirementRecord as jest.Mock).mockResolvedValue({ success: false, code: "not_found" });
    expect((await DELETE(req("DELETE"), params())).status).toBe(404);
  });
  it("200 success", async () => {
    (deleteRequirementRecord as jest.Mock).mockResolvedValue({ success: true });
    const res = await DELETE(req("DELETE"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
