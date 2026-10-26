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
        for: rows,
        then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => rows().then(res, rej),
      };
    };
    return node;
  };
  const tx = {
    select: () => chain(),
    delete: () => ({ where: (...a: unknown[]) => { mockDelete(...a); return Promise.resolve(); } }),
    insert: () => ({
      values: (v: unknown) => { mockInsertValues(v); return { onConflictDoNothing: () => Promise.resolve() }; },
    }),
  };
  return {
    db: {
      select: () => chain(),
      transaction: async (run: (t: unknown) => unknown) => { mockTransaction(); return run(tx); },
    },
  };
});
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { PATCH } from "./route";

const TEST = "44444444-4444-4444-8444-444444444444";
const T1 = "66666666-6666-4666-8666-666666666666";
const T2 = "77777777-7777-4777-8777-777777777777";
const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const params = (id = TEST) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new NextRequest(`http://localhost/api/tests/${TEST}/tags`, {
    method: "PATCH",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("PATCH /api/tests/[id]/tags", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await PATCH(req({ add: [T1] }), params())).status).toBe(401);
  });
  it("403 without test:update", async () => {
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await PATCH(req({ add: [T1] }), params())).status).toBe(403);
    expect(checkPermissionWithContext).toHaveBeenCalledWith("test", "update", authCtx);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  it("404 for a malformed id or a test outside the project", async () => {
    expect((await PATCH(req({ add: [T1] }), params("nope"))).status).toBe(404);
    mockSelectQueue.push([]);
    expect((await PATCH(req({ add: [T1] }), params())).status).toBe(404);
  });
  it("400 on invalid bodies", async () => {
    expect((await PATCH(req({ add: "x" }), params())).status).toBe(400);
    expect((await PATCH(req({ remove: ["nope"] }), params())).status).toBe(400);
    expect((await PATCH(req({ add: [T1], remove: [T1] }), params())).status).toBe(400);
    expect((await PATCH(req("{"), params())).status).toBe(400);
  });
  it("400 when an added tag is from another project", async () => {
    mockSelectQueue.push([{ id: TEST }], [{ id: T1 }]);
    expect((await PATCH(req({ add: [T1, T2] }), params())).status).toBe(400);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
  it("400 when the cap would be exceeded", async () => {
    mockSelectQueue.push([{ id: TEST }], [{ id: T1 }], [{ id: TEST }], [{ count: 11 }]);
    const res = await PATCH(req({ add: [T1] }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Maximum of 10/);
  });
  it("404 when the test disappears before the lock", async () => {
    mockSelectQueue.push([{ id: TEST }], [{ id: T1 }], []);
    expect((await PATCH(req({ add: [T1] }), params())).status).toBe(404);
  });
  it("200 applies add and remove in one transaction", async () => {
    mockSelectQueue.push([{ id: TEST }], [{ id: T1 }], [{ id: TEST }], [{ count: 2 }], [{ id: T1, name: "a" }]);
    const res = await PATCH(req({ add: [T1], remove: [T2] }), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledWith([{ testId: TEST, tagId: T1 }]);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual([{ id: T1, name: "a" }]);
  });
  it("200 removing an unassigned tag is a no-op success", async () => {
    mockSelectQueue.push([{ id: TEST }], [{ id: TEST }], []);
    const res = await PATCH(req({ remove: [T2] }), params());
    expect(res.status).toBe(200);
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(await res.json()).toEqual([]);
  });
  it("500 on unexpected database errors", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockSelectQueue.push([{ id: TEST }], [{ id: TEST }]);
    mockDelete.mockImplementationOnce(() => { throw new Error("boom"); });
    expect((await PATCH(req({ remove: [T1] }), params())).status).toBe(500);
  });
});
