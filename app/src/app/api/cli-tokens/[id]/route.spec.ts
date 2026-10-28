/** @jest-environment node */
import { NextRequest } from "next/server";

let tokenRows: unknown[] = [];
let usableCount = 0;
let lockedRow: { enabled: boolean } | null | undefined;
const updates: Record<string, unknown>[] = [];
const mockRequireAuth = jest.fn();

jest.mock("@/utils/db", () => {
  const update = () => ({
    set: (v: Record<string, unknown>) => {
      updates.push(v);
      return { where: () => ({ returning: async () => [{ id: "t1", name: "CI", enabled: v.enabled }] }) };
    },
  });
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => tokenRows }) }) }),
    update,
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => undefined, update, select: () => ({ from: () => ({ where: () => Object.assign(Promise.resolve([{ count: usableCount }]), { limit: async () => (lockedRow === null ? [] : [lockedRow ?? { enabled: (tokenRows[0] as { enabled?: boolean })?.enabled }]) }) }) }) }),
  };
  return { db };
});
jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: (...a: unknown[]) => mockRequireAuth(...a),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/logger/pino-config", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { PATCH } from "./route";

const tokenId = "22222222-2222-4222-8222-222222222222";
const patch = (body: unknown) =>
  PATCH(
    new NextRequest(`https://app.example.com/api/cli-tokens/${tokenId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: tokenId }) },
  );

beforeEach(() => {
  updates.length = 0;
  usableCount = 0;
  lockedRow = undefined;
  mockRequireAuth.mockResolvedValue({ userId: "u1", organizationId: "o1", project: { id: "p1" }, isCliAuth: true });
});

describe("PATCH /api/cli-tokens/[id]", () => {
  it("lets the owner re-enable their token", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u1", enabled: false }];
    expect((await patch({ enabled: true })).status).toBe(200);
    expect(updates[0]).toMatchObject({ enabled: true });
  });

  it("refuses to re-enable a token once the project is at the usable-key cap", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u1", enabled: false }];
    usableCount = 20;
    expect((await patch({ enabled: true })).status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it("does not apply the cap to a token that is already enabled", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u1", enabled: true }];
    usableCount = 20;
    expect((await patch({ enabled: true })).status).toBe(200);
  });

  it("returns 404, not the cap error, when the token disappears before the locked re-read", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u1", enabled: false }];
    lockedRow = null;
    expect((await patch({ enabled: true })).status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it("refuses to re-enable another member's revoked token", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u2" }];
    expect((await patch({ enabled: true })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });

  it("still lets a project admin revoke or rename another member's token", async () => {
    tokenRows = [{ id: tokenId, projectId: "p1", jobId: null, ownerId: "u2" }];
    expect((await patch({ enabled: false, name: "old" })).status).toBe(200);
    expect(updates[0]).toMatchObject({ enabled: false, name: "old" });
  });
});
