/** @jest-environment node */
import { NextRequest } from "next/server";

let keyRows: unknown[] = [];
const updates: Record<string, unknown>[] = [];
const mockPermission = jest.fn();

jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ leftJoin: () => ({ where: () => ({ limit: async () => keyRows }) }) }) }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        return { where: () => ({ returning: async () => [{ id: "k1" }] }) };
      },
    }),
  },
}));
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1" } }),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: (...a: unknown[]) => mockPermission(...a) }));

import { PATCH } from "./route";

const ids = { id: "11111111-1111-4111-8111-111111111111", keyId: "22222222-2222-4222-8222-222222222222" };
const patch = (body: unknown) =>
  PATCH(
    new NextRequest("https://app.example.com/api/jobs/x/api-keys/y", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(ids) },
  );

beforeEach(() => {
  updates.length = 0;
  keyRows = [{ id: ids.keyId, jobId: ids.id, ownerId: "u2", enabled: false }];
  mockPermission.mockImplementation((_r: string, action: string) => action === "update");
});

describe("PATCH /api/jobs/[id]/api-keys/[keyId]", () => {
  it.each([{ enabled: "x" }, { name: { a: 1 } }, { name: "" }, { name: "n".repeat(101) }, {}])("rejects invalid body %j", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("does not let a non-owner without apiKey:delete re-enable a disabled key", async () => {
    expect((await patch({ enabled: true })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("lets the key owner or an apiKey:delete holder re-enable it", async () => {
    keyRows = [{ id: ids.keyId, jobId: ids.id, ownerId: "u1", enabled: false }];
    expect((await patch({ enabled: true })).status).toBe(200);
    keyRows = [{ id: ids.keyId, jobId: ids.id, ownerId: "u2", enabled: false }];
    mockPermission.mockReturnValue(true);
    expect((await patch({ enabled: true })).status).toBe(200);
  });

  it("still lets an apiKey:update holder disable or rename", async () => {
    expect((await patch({ enabled: false, name: "ci" })).status).toBe(200);
    expect(updates[0]).toMatchObject({ enabled: false, name: "ci" });
  });
});
