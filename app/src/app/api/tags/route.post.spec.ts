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
const mockInsert = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = mockSelectQueue.shift() ?? [];
          return Object.assign(Promise.resolve(rows), { limit: async () => rows });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mockInsert(values);
        return { returning: async () => [{ id: "t", ...values }] };
      },
    }),
  },
}));
import { NextRequest } from "next/server";
import { tagColorError, tagNameError } from "@/lib/tag-validation";
import { POST } from "./route";

const post = (body: object) => POST(new NextRequest("http://localhost/api/tags", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockInsert.mockClear();
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

  it("answers 409 for a duplicate name", async () => {
    mockSelectQueue.push([{ id: "existing" }]);
    expect((await post({ name: "prod" })).status).toBe(409);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("creates a valid tag with its color", async () => {
    mockSelectQueue.push([], []);
    const res = await post({ name: " release-1 ", color: "#3B82F6" });
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ name: "release-1", color: "#3B82F6" }));
  });
});
