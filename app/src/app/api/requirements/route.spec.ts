/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

const mockLimit = jest.fn();
const mockOffset = jest.fn();
const mockRowQueue: unknown[][] = [];
jest.mock("@/utils/db", () => {
  const chain = (): Record<string, unknown> => {
    const node: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "innerJoin", "where", "orderBy"]) node[m] = () => node;
    node.offset = (n: number) => { mockOffset(n); return node; };
    node.limit = (n: number) => { mockLimit(n); return node; };
    node.then = (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(mockRowQueue.shift() ?? []).then(res, rej);
    return node;
  };
  return { db: { select: () => chain() } };
});
jest.mock("@/lib/requirements/service", () => ({
  createRequirementWithRelations: jest.fn(),
  getRequirementDto: jest.fn(),
  restCreateRequirementSchema: jest.requireActual("@/lib/requirements/service").restCreateRequirementSchema,
  toServiceContext: (c: { userId: string; organizationId: string; project: { id: string; name: string } }) => ({
    userId: c.userId, organizationId: c.organizationId, projectId: c.project.id, projectName: c.project.name,
  }),
}));
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { createRequirementWithRelations, getRequirementDto } from "@/lib/requirements/service";
import { GET, POST } from "./route";

const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/requirements", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRowQueue.length = 0;
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

  it("400 on unknown keys, javascript: URLs and a whitespace-only title", async () => {
    expect((await post({ title: "x", bogus: true })).status).toBe(400);
    expect((await post({ title: "x", externalUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await post({ title: "x", externalUrl: "data:text/html,hi" })).status).toBe(400);
    expect((await post({ title: "   " })).status).toBe(400);
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

describe("GET /api/requirements list fields", () => {
  it("includes batch-loaded testIds and sorted tagNames next to the existing tags objects", async () => {
    mockRowQueue.push(
      [{ count: 1 }],
      [{ id: "r1", title: "T", createdAt: new Date(0), updatedAt: new Date(0) }],
      [
        { requirementId: "r1", tagId: "t2", tagName: "smoke", tagColor: "#fff" },
        { requirementId: "r1", tagId: "t1", tagName: "Auth", tagColor: null },
      ],
      [{ requirementId: "r1", testId: "tt1" }, { requirementId: "r1", testId: "tt2" }]
    );
    const res = await GET(new NextRequest("http://localhost/api/requirements"));
    const body = await res.json();
    expect(body.data[0]).toMatchObject({
      id: "r1",
      tags: [
        { id: "t2", name: "smoke", color: "#fff" },
        { id: "t1", name: "Auth", color: null },
      ],
      tagNames: ["Auth", "smoke"],
      testIds: ["tt1", "tt2"],
    });
  });

  it("returns empty arrays for a requirement with no tags or tests", async () => {
    mockRowQueue.push([{ count: 1 }], [{ id: "r2", title: "T" }], [], []);
    const body = await (await GET(new NextRequest("http://localhost/api/requirements"))).json();
    expect(body.data[0]).toMatchObject({ tags: [], tagNames: [], testIds: [] });
  });
});

describe("GET /api/requirements pagination", () => {
  const get = (qs: string) => GET(new NextRequest(`http://localhost/api/requirements${qs}`));

  it("defaults to page 1 / pageSize 500 (the dashboard fetches everything unpaged)", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect(mockLimit).toHaveBeenCalledWith(500);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it("falls back to defaults for NaN and clamps out-of-range values", async () => {
    await get("?page=abc&pageSize=xyz");
    expect(mockLimit).toHaveBeenLastCalledWith(500);
    expect(mockOffset).toHaveBeenLastCalledWith(0);
    await get("?page=-3&pageSize=0");
    expect(mockLimit).toHaveBeenLastCalledWith(1);
    expect(mockOffset).toHaveBeenLastCalledWith(0);
    await get("?page=2&pageSize=100000");
    expect(mockLimit).toHaveBeenLastCalledWith(500);
    expect(mockOffset).toHaveBeenLastCalledWith(500);
  });
});
