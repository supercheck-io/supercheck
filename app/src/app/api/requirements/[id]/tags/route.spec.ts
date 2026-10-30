/** @jest-environment node */
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));

const mockTx = { delete: jest.fn(), insert: jest.fn() };
const mockDb = {
  select: jest.fn(),
  transaction: jest.fn(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
};
jest.mock("@/utils/db", () => ({
  db: {
    select: (...a: unknown[]) => mockDb.select(...a),
    transaction: (...a: unknown[]) => (mockDb.transaction as (...x: unknown[]) => unknown)(...a),
  },
}));

import { NextRequest } from "next/server";
import { requireAuthContext } from "@/lib/auth-context";
import { POST } from "./route";

const REQ = "44444444-4444-4444-8444-444444444444";
const TAG = "55555555-5555-4555-8555-555555555555";
const params = { params: Promise.resolve({ id: REQ }) };
const post = (body: string) =>
  POST(new NextRequest("http://x/api/requirements/r/tags", { method: "POST", body }), params);

function selectRows(...results: unknown[][]) {
  mockDb.select.mockReset();
  for (const rows of results) {
    const q: Record<string, unknown> = {};
    for (const k of ["from", "where", "innerJoin"]) q[k] = () => q;
    q.limit = () => Promise.resolve(rows);
    q.orderBy = () => Promise.resolve(rows);
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
    mockDb.select.mockReturnValueOnce(q);
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireAuthContext as jest.Mock).mockResolvedValue({ organizationId: "o", project: { id: "p" } });
  mockTx.delete.mockReturnValue({ where: () => Promise.resolve() });
  mockTx.insert.mockReturnValue({ values: () => Promise.resolve() });
});

describe("POST /api/requirements/[id]/tags", () => {
  it("400 on invalid JSON instead of a 500", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it("400 when tag ids are not uuids or exceed the cap", async () => {
    expect((await post(JSON.stringify({ tagIds: ["not-a-uuid"] }))).status).toBe(400);
    const many = Array.from({ length: 11 }, (_, i) => `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`);
    expect((await post(JSON.stringify({ tagIds: many }))).status).toBe(400);
  });

  it("replaces tags inside one transaction", async () => {
    selectRows([{ id: REQ }], [{ id: TAG }], []);
    const res = await post(JSON.stringify({ tagIds: [TAG] }));
    expect(res.status).toBe(200);
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.delete).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });
});
