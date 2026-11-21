/** @jest-environment node */
jest.mock("@/lib/deletion/org-state", () => ({
  permissionDeniedResponse: async (_org: unknown, message: string) => Response.json({ error: message }, { status: 403 }),
}));
jest.mock("@/lib/auth-context", () => ({
  authErrorStatus: () => 401,
  requireAuthContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "p" } })),
  isAuthError: () => false,
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));

// Select order in PUT: tag lookup, then the duplicate-name lookup.
const mockSelectQueue: unknown[][] = [];
const mockWheres: unknown[] = [];
const mockSet = jest.fn();
let mockUpdateError: unknown;
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          mockWheres.push(w);
          return { limit: async () => mockSelectQueue.shift() ?? [] };
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mockSet(values);
        return {
          where: () => ({
            returning: async () => {
              if (mockUpdateError) throw mockUpdateError;
              return [{ id: TAG, ...values }];
            },
          }),
        };
      },
    }),
  },
}));
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { tagNameError } from "@/lib/tag-validation";
import { PUT } from "./route";

const TAG = "66666666-6666-4666-8666-666666666666";
const put = (body: object) =>
  PUT(new NextRequest(`http://localhost/api/tags/${TAG}`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: TAG }) });

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockWheres.length = 0;
  mockSet.mockClear();
  mockUpdateError = undefined;
});

describe("tag rename", () => {
  it.each(["   ", "ab", "a".repeat(21), "has space", "bad!char"])("rejects %p with the create rules", async (name) => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }]);
    const res = await put({ name });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(tagNameError(name.trim()));
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("answers 409 when another tag in the project has the name", async () => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], [{ id: "77777777-7777-4777-8777-777777777777", name: "staging" }]);
    expect((await put({ name: "staging" })).status).toBe(409);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("renames to a valid name", async () => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], []);
    expect((await put({ name: " release-1 " })).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ name: "release-1" }));
  });

  it("still lets a tag whose stored name predates the rules change color", async () => {
    mockSelectQueue.push([{ id: TAG, name: "legacy tag", color: "#000000" }], [{ id: TAG, name: "legacy tag" }]);
    expect((await put({ name: "legacy tag", color: "#FFFFFF" })).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ name: "legacy tag", color: "#FFFFFF" }));
  });

  it.each(["red", "#FFF", "#GGGGGG", "#3B82F6; x"])("rejects color %p", async (color) => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], []);
    const res = await put({ name: "prod", color });
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("lets a tag keep a stored color that predates the rules while it is renamed", async () => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "red" }], []);
    expect((await put({ name: "production", color: "red" })).status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ name: "production", color: "red" }));
  });

  it("checks duplicates case-insensitively and excludes the tag itself", async () => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], [{ id: "77777777-7777-4777-8777-777777777777", name: "Staging" }]);
    expect((await put({ name: "staging" })).status).toBe(409);
    const { sql: text, params } = new PgDialect().sqlToQuery(mockWheres[1] as SQL);
    expect(text).toContain("lower(");
    expect(text).toContain("<>");
    expect(params).toEqual(expect.arrayContaining(["staging", TAG]));
  });

  it("skips the duplicate check when the name is unchanged, so a legacy case-twin can still change color", async () => {
    mockSelectQueue.push([{ id: TAG, name: "smoke", color: "#000000" }], [{ id: "77777777-7777-4777-8777-777777777777", name: "Smoke" }]);
    expect((await put({ name: "smoke", color: "#FFFFFF" })).status).toBe(200);
    expect(mockWheres).toHaveLength(1);
  });

  it("answers 409 when a concurrent rename wins the unique name index", async () => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], []);
    mockUpdateError = Object.assign(new Error("dup"), { cause: { code: "23505", constraint_name: "tags_project_name_idx" } });
    const res = await put({ name: "staging" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Tag with this name already exists");
  });

  it.each([
    ["another unique index", { code: "23505", constraint_name: "tags_pkey" }],
    ["another error", { code: "57014" }],
  ])("answers 500 for %s", async (_label, cause) => {
    mockSelectQueue.push([{ id: TAG, name: "prod", color: "#000000" }], []);
    mockUpdateError = Object.assign(new Error("boom"), { cause });
    expect((await put({ name: "staging" })).status).toBe(500);
  });
});
