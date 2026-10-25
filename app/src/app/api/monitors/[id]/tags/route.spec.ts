/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

const mockSelectQueue: unknown[][] = [];
const mockDelete = jest.fn();
const mockInsertValues = jest.fn();
const mockTransaction = jest.fn();
const mockAudit = jest.fn();
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: (...a: unknown[]) => mockAudit(...a) }));
jest.mock("@/utils/db", () => {
  const chain = () => {
    const node: Record<string, unknown> = {};
    node.from = () => node;
    node.innerJoin = () => node;
    node.where = () => {
      let cached: Promise<unknown[]> | undefined;
      const rows = () => (cached ??= Promise.resolve(mockSelectQueue.shift() ?? []));
      return {
        limit: rows,
        orderBy: rows,
        then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => rows().then(res, rej),
      };
    };
    return node;
  };
  const tx = {
    delete: () => ({ where: (...a: unknown[]) => { mockDelete(...a); return Promise.resolve(); } }),
    insert: () => ({ values: (v: unknown) => { mockInsertValues(v); return Promise.resolve(); } }),
  };
  return {
    db: {
      select: () => chain(),
      delete: () => ({ where: (...a: unknown[]) => { mockDelete(...a); return Promise.resolve(); } }),
      insert: () => { throw new Error("tag replacement must go through the transaction"); },
      transaction: async (run: (t: unknown) => unknown) => { mockTransaction(); return run(tx); },
    },
  };
});
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { GET, POST, DELETE } from "./route";

const M = "44444444-4444-4444-8444-444444444444";
const T1 = "66666666-6666-4666-8666-666666666666";
const T2 = "77777777-7777-4777-8777-777777777777";
const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const params = (id = M) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/monitors/${M}/tags`, { method, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("GET /api/monitors/[id]/tags", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await GET(req("GET"), params())).status).toBe(401);
  });
  it("403 without monitor:view", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await GET(req("GET"), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "view", authCtx);
  });
  it("404 for a monitor outside the project", async () => {
    mockSelectQueue.push([]);
    expect((await GET(req("GET"), params())).status).toBe(404);
  });
  it("200 returns { tags }", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1, name: "a", color: "#fff" }]);
    const res = await GET(req("GET"), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: [{ id: T1, name: "a", color: "#fff" }] });
  });
});

describe("POST /api/monitors/[id]/tags", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await POST(req("POST", { tagIds: [T1] }), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "update", authCtx);
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it("400 on invalid bodies", async () => {
    expect((await POST(req("POST", { tagIds: "x" }), params())).status).toBe(400);
    expect((await POST(req("POST", { tagIds: ["nope"] }), params())).status).toBe(400);
    expect((await POST(req("POST", { tagIds: [T1, T1] }), params())).status).toBe(400);
  });
  it("404 for a monitor outside the project", async () => {
    mockSelectQueue.push([]);
    expect((await POST(req("POST", { tagIds: [T1] }), params())).status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it("400 when a tag is from another project", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }]);
    expect((await POST(req("POST", { tagIds: [T1, T2] }), params())).status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
  it("200 replaces the tag set", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }, { id: T2 }], [{ id: T1, name: "a", color: null }]);
    const res = await POST(req("POST", { tagIds: [T1, T2] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith([{ monitorId: M, tagId: T1 }, { monitorId: M, tagId: T2 }]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "monitor_tags_updated",
        resource: "monitor",
        resourceId: M,
        organizationId: "o",
        metadata: { tagIds: [T1, T2], projectId: "p" },
      })
    );
    expect(await res.json()).toEqual({ tags: [{ id: T1, name: "a", color: null }] });
  });
  it("200 with an empty array clears all tags", async () => {
    mockSelectQueue.push([{ id: M }], []);
    const res = await POST(req("POST", { tagIds: [] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/monitors/[id]/tags", () => {
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await DELETE(req("DELETE", { tagId: T1 }), params())).status).toBe(403);
  });
  it("400 without a valid tagId", async () => {
    expect((await DELETE(req("DELETE", {}), params())).status).toBe(400);
  });
  it("404 for a monitor outside the project", async () => {
    mockSelectQueue.push([]);
    expect((await DELETE(req("DELETE", { tagId: T1 }), params())).status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });
  it("200 removes the tag", async () => {
    mockSelectQueue.push([{ id: M }]);
    const res = await DELETE(req("DELETE", { tagId: T1 }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(mockDelete).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor_tag_removed", resourceId: M, metadata: { tagId: T1, projectId: "p" } })
    );
  });
});
