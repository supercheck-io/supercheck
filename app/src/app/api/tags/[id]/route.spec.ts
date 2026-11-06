/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  authErrorStatus: (e: unknown) => ((e as { status?: number })?.status === 403 ? 403 : 401),
  requireAuthContext: jest.fn(),
  isAuthError: (e: unknown) => (e as { name?: string })?.name === "AuthError",
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn() }));

const mockSelectQueue: unknown[][] = [];
const mockDelete = jest.fn();
const mockFor = jest.fn();
jest.mock("@/utils/db", () => {
  const chain = () => {
    const node: Record<string, unknown> = {};
    node.from = () => node;
    node.where = () => {
      const rows = () => Promise.resolve(mockSelectQueue.shift() ?? []);
      return {
        limit: () => ({ for: (...a: unknown[]) => { mockFor(...a); return rows(); } }),
        then: (res: (v: unknown[]) => unknown, rej?: (e: unknown) => unknown) => rows().then(res, rej),
      };
    };
    return node;
  };
  const tx = {
    select: () => chain(),
    delete: () => ({ where: (...a: unknown[]) => { mockDelete(...a); return Promise.resolve(); } }),
  };
  return {
    db: {
      select: () => { throw new Error("DELETE must query inside the transaction"); },
      delete: () => { throw new Error("DELETE must delete inside the transaction"); },
      transaction: async (run: (t: unknown) => unknown) => run(tx),
    },
  };
});
import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { DELETE } from "./route";

const TAG = "66666666-6666-4666-8666-666666666666";
const authCtx = { userId: "u", organizationId: "o", project: { id: "p", name: "P" } };
const params = (id = TAG) => ({ params: Promise.resolve({ id }) });
const req = () => new NextRequest(`http://localhost/api/tags/${TAG}`, { method: "DELETE" });
const tagRow = { id: TAG, name: "prod", createdByUserId: "u" };

// Select order in DELETE: tag lookup, test usage, requirement usage, monitor usage.
const queue = (tests: number, requirements: number, monitors: number) =>
  mockSelectQueue.push([tagRow], [{ count: tests }], [{ count: requirements }], [{ count: monitors }]);

beforeEach(() => {
  jest.clearAllMocks();
  mockSelectQueue.length = 0;
  (requireAuthContext as jest.Mock).mockResolvedValue(authCtx);
  (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
});

describe("DELETE /api/tags/[id]", () => {
  it("401 unauthenticated", async () => {
    (requireAuthContext as jest.Mock).mockRejectedValue(Object.assign(new Error("x"), { name: "AuthError" }));
    expect((await DELETE(req(), params())).status).toBe(401);
  });

  it("404 for a malformed id or a tag outside the project", async () => {
    expect((await DELETE(req(), params("nope"))).status).toBe(404);
    mockSelectQueue.push([]);
    expect((await DELETE(req(), params())).status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("403 without tag:delete", async () => {
    mockSelectQueue.push([tagRow]);
    (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
    expect((await DELETE(req(), params())).status).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("409 when the tag is used only by monitors", async () => {
    queue(0, 0, 2);
    const res = await DELETE(req(), params());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ usageCount: 2, testCount: 0, requirementCount: 0, monitorCount: 2 });
    expect(body.error).toContain("2 monitors");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("409 lists every resource kind that uses the tag", async () => {
    queue(1, 1, 1);
    const res = await DELETE(req(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("1 test, 1 requirement and 1 monitor");
  });

  it("500 when the delete fails", async () => {
    mockSelectQueue.push([tagRow]);
    mockDelete.mockImplementationOnce(() => { throw new Error("boom"); });
    mockSelectQueue.push([{ count: 0 }], [{ count: 0 }], [{ count: 0 }]);
    expect((await DELETE(req(), params())).status).toBe(500);
  });

  it("deletes an unused tag", async () => {
    queue(0, 0, 0);
    const res = await DELETE(req(), params());
    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockFor).toHaveBeenCalledWith("update");
  });
});
