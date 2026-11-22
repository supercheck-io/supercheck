/** @jest-environment node */
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async (_org: unknown, message: string) => Response.json({ error: message }, { status: 403 }),
}));
jest.mock("@/lib/auth-context", () => ({
  authErrorStatus: () => 401,
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p" }, isCliAuth: true })),
  requireUserAuthContext: jest.fn(),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));

// Select order in POST: the duplicate-name lookup (limit), then the per-project count (no limit).
const mockSelectQueue: unknown[][] = [];
const mockWheres: unknown[] = [];
const mockInsert = jest.fn();
const mockExecute = jest.fn();
const mockTransaction = jest.fn();
let mockInsertError: unknown;
jest.mock("@/utils/db", () => {
  const db: Record<string, unknown> = {
    execute: (q: unknown) => mockExecute(q),
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          mockWheres.push(w);
          const rows = mockSelectQueue.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mockInsert(values);
        return {
          returning: async () => {
            if (mockInsertError) throw mockInsertError;
            return [{ id: "t", ...values }];
          },
        };
      },
    }),
  };
  // The transaction hands the same mock back as `tx`, so every query is recorded in one place.
  db.transaction = (fn: (tx: unknown) => unknown) => {
    mockTransaction();
    return fn(db);
  };
  return { db };
});
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { tagColorError, tagNameError } from "@/lib/tag-validation";
import { POST } from "./route";

const post = (body: object) => POST(new NextRequest("http://localhost/api/tags", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockWheres.length = 0;
  mockInsert.mockClear();
  mockTransaction.mockClear();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([]);
  mockInsertError = undefined;
});

describe("tag create", () => {
  it.each(["ab", "has space", "bad!char"])("rejects name %p", async (name) => {
    const res = await post({ name });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(tagNameError(name));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each(["red", "#FFF", "x".repeat(60)])("rejects color %p", async (color) => {
    const res = await post({ name: "prod", color });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(tagColorError(color));
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("answers 409 for a duplicate name, compared case-insensitively", async () => {
    mockSelectQueue.push([{ id: "existing" }]);
    expect((await post({ name: "Prod" })).status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
    const { sql: text, params } = new PgDialect().sqlToQuery(mockWheres[0] as SQL);
    expect(text).toContain("lower(");
    expect(params).toContain("prod");
  });

  it("answers 409 when a concurrent create wins the unique name index", async () => {
    mockSelectQueue.push([], [{ count: 0 }]);
    mockInsertError = Object.assign(new Error("dup"), { code: "23505", constraint_name: "tags_project_name_idx" });
    const res = await post({ name: "prod" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Tag already exists in this project");
  });

  it.each([
    ["another unique index", { code: "23505", constraint_name: "tags_pkey" }],
    ["another error", { code: "57014" }],
  ])("answers 500 for %s", async (_label, fields) => {
    mockSelectQueue.push([], [{ count: 0 }]);
    mockInsertError = Object.assign(new Error("boom"), fields);
    expect((await post({ name: "prod" })).status).toBe(500);
  });

  it("creates a valid tag with its color", async () => {
    mockSelectQueue.push([], [{ count: 0 }]);
    const res = await post({ name: " release-1 ", color: "#3B82F6" });
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: "release-1", color: "#3B82F6" }));
  });

  it("takes the project-tag lock in the same transaction as the lookup, count and insert", async () => {
    mockSelectQueue.push([], [{ count: 0 }]);
    expect((await post({ name: "prod" })).status).toBe(201);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const lock = mockExecute.mock.calls
      .map(([q]) => new PgDialect().sqlToQuery(q as SQL))
      .find((q) => q.sql.includes("pg_advisory_xact_lock"));
    expect(lock?.params).toEqual(["project-tags:o:p"]);
  });

  it("answers 400 once the project holds 50 tags", async () => {
    mockSelectQueue.push([], [{ count: 50 }]);
    const res = await post({ name: "prod" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Maximum of 50 tags allowed per project");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates the 50th tag", async () => {
    mockSelectQueue.push([], [{ count: 49 }]);
    expect((await post({ name: "prod" })).status).toBe(201);
  });

  it("answers 503 with Retry-After when the project-tag lock times out", async () => {
    mockExecute.mockImplementation(async (q: SQL) => {
      if (new PgDialect().sqlToQuery(q).sql.includes("pg_advisory_xact_lock")) {
        throw Object.assign(new Error("lock timeout"), { code: "55P03" });
      }
      return [];
    });
    const res = await post({ name: "prod" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
