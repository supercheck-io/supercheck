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
const mockSet = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => mockSelectQueue.shift() ?? [] }) }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mockSet(values);
        return { where: () => ({ returning: async () => [{ id: TAG, ...values }] }) };
      },
    }),
  },
}));
import { NextRequest } from "next/server";
import { tagNameError } from "@/lib/tag-validation";
import { PUT } from "./route";

const TAG = "66666666-6666-4666-8666-666666666666";
const put = (body: object) =>
  PUT(new NextRequest(`http://localhost/api/tags/${TAG}`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: TAG }) });

beforeEach(() => {
  mockSelectQueue.length = 0;
  mockSet.mockClear();
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
});
