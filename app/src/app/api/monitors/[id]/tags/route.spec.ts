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
const mockFor = jest.fn();
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
        for: (...a: unknown[]) => { mockFor(...a); return rows(); },
        orderBy: rows,
        then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => rows().then(res, rej),
      };
    };
    return node;
  };
  const tx = {
    isTx: true,
    select: () => chain(),
    delete: () => ({ where: (...a: unknown[]) => { mockDelete(...a); return Promise.resolve(); } }),
    insert: () => ({ values: (v: unknown) => { mockInsertValues(v); return Object.assign(Promise.resolve(), { onConflictDoNothing: () => Promise.resolve() }); } }),
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
import { GET, POST, PATCH, DELETE } from "./route";

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
    mockSelectQueue.push([{ id: M }], [{ id: T1 }, { id: T2 }], [{ id: M }], [{ id: T1, name: "a", color: null }]);
    const res = await POST(req("POST", { tagIds: [T1, T2] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith([{ monitorId: M, tagId: T1 }, { monitorId: M, tagId: T2 }]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockFor).toHaveBeenCalledWith("update"); // same row lock as PATCH
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "monitor_tags_updated",
        resource: "monitor",
        resourceId: M,
        organizationId: "o",
        metadata: { tagIds: [T1, T2], projectId: "p" },
      }),
      expect.objectContaining({ isTx: true }),
      { strict: true },
    );
    expect(await res.json()).toEqual({ tags: [{ id: T1, name: "a", color: null }] });
  });
  it("400 when a tag is deleted before the insert (FK violation)", async () => {
    mockInsertValues.mockImplementationOnce(() => { throw Object.assign(new Error("fk"), { cause: { code: "23503", constraint_name: "monitor_tags_tag_id_tags_id_fk" } }); });
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], [{ id: M }]);
    const res = await POST(req("POST", { tagIds: [T1] }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("One or more tags no longer exist");
    expect(mockAudit).not.toHaveBeenCalled();
  });
  it("200 with an empty array clears all tags", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: M }], []);
    const res = await POST(req("POST", { tagIds: [] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/monitors/[id]/tags", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await PATCH(req("PATCH", { add: [T1] }), params())).status).toBe(401);
  });
  it("403 for a viewer", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await PATCH(req("PATCH", { add: [T1] }), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("monitor", "update", authCtx);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  it("404 for a malformed id or a monitor outside the project", async () => {
    expect((await PATCH(req("PATCH", { add: [T1] }), params("nope"))).status).toBe(404);
    mockSelectQueue.push([]);
    expect((await PATCH(req("PATCH", { add: [T1] }), params())).status).toBe(404);
  });
  it("400 on invalid bodies", async () => {
    expect((await PATCH(req("PATCH", { add: "x" }), params())).status).toBe(400);
    expect((await PATCH(req("PATCH", { remove: ["nope"] }), params())).status).toBe(400);
    expect((await PATCH(req("PATCH", { add: [T1], remove: [T1] }), params())).status).toBe(400);
    const bad = new NextRequest(`http://localhost/api/monitors/${M}/tags`, { method: "PATCH", body: "{" });
    expect((await PATCH(bad, params())).status).toBe(400);
  });
  it("400 when an added tag is from another project", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }]);
    expect((await PATCH(req("PATCH", { add: [T1, T2] }), params())).status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  it("400 and rolls back when the cap would be exceeded", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], [{ id: M }], [{ count: 11 }]);
    const res = await PATCH(req("PATCH", { add: [T1] }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Maximum of 10/);
    expect(mockAudit).not.toHaveBeenCalled();
  });
  it("404 when the monitor disappears before the lock", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], []);
    expect((await PATCH(req("PATCH", { add: [T1] }), params())).status).toBe(404);
  });
  it("200 applies add and remove in one transaction with an audit event", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], [{ id: M }], [{ count: 2 }], [{ id: T1, name: "a", color: null }]);
    const res = await PATCH(req("PATCH", { add: [T1], remove: [T2] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith([{ monitorId: M, tagId: T1 }]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor_tags_updated", resourceId: M, metadata: { add: [T1], remove: [T2], projectId: "p" } }),
      expect.objectContaining({ isTx: true }),
      { strict: true },
    );
    expect(await res.json()).toEqual({ tags: [{ id: T1, name: "a", color: null }] });
  });
  it("200 removing an unassigned tag is a no-op success", async () => {
    mockSelectQueue.push([{ id: M }], [{ id: M }], []);
    const res = await PATCH(req("PATCH", { remove: [T2] }), params());
    expect(res.status).toBe(200);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ tags: [] });
  });
  it("400 when an added tag is deleted before the insert (FK violation)", async () => {
    mockInsertValues.mockImplementationOnce(() => { throw Object.assign(new Error("fk"), { code: "23503", constraint_name: "monitor_tags_tag_id_tags_id_fk" }); });
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], [{ id: M }]);
    const res = await PATCH(req("PATCH", { add: [T1] }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("One or more tags no longer exist");
  });
  it("does not report a missing tag when the monitor FK is violated", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockInsertValues.mockImplementationOnce(() => { throw Object.assign(new Error("fk"), { code: "23503", constraint_name: "monitor_tags_monitor_id_monitors_id_fk" }); });
    mockSelectQueue.push([{ id: M }], [{ id: T1 }], [{ id: M }]);
    expect((await PATCH(req("PATCH", { add: [T1] }), params())).status).toBe(500);
  });
  it("500 on unexpected database errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockSelectQueue.push([{ id: M }], [{ id: M }]);
    mockDelete.mockImplementationOnce(() => { throw new Error("boom"); });
    expect((await PATCH(req("PATCH", { remove: [T1] }), params())).status).toBe(500);
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
      expect.objectContaining({ action: "monitor_tag_removed", resourceId: M, metadata: { tagId: T1, projectId: "p" } }),
      expect.objectContaining({ isTx: true }),
      { strict: true },
    );
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
