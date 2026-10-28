/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/rbac/middleware", () => ({ hasPermissionForUser: jest.fn() }));
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn() }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
import { PUT } from "./route";
import { db } from "@/utils/db";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { requireUserAuthContext } from "@/lib/auth-context";

const ID = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const set = jest.fn();
const put = (body: unknown) =>
  PUT(
    new NextRequest(`http://localhost/api/projects/${ID}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) },
  );
const project = (status = "active") => ({
  from: () => ({ where: () => ({ limit: async () => [{ organizationId: "org-1", status }] }) }),
});

beforeEach(() => {
  jest.clearAllMocks();
  (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u1" });
  (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  (db.select as jest.Mock).mockReturnValue(project());
  set.mockReturnValue({ where: () => ({ returning: async () => [{ id: ID }] }) });
  (db.update as jest.Mock).mockReturnValue({ set });
});

describe("PUT /api/projects/[id]", () => {
  it("never writes status, even when the body supplies one", async () => {
    expect((await put({ name: "x", status: "deleted" })).status).toBe(200);
    expect(set.mock.calls[0][0]).not.toHaveProperty("status");
  });

  it("updates only the fields present", async () => {
    await put({ name: "renamed" });
    const written = set.mock.calls[0][0];
    expect(written.name).toBe("renamed");
    expect(written).not.toHaveProperty("slug");
    expect(written).not.toHaveProperty("description");
  });

  it("rejects invalid bodies", async () => {
    expect((await put({ name: "x".repeat(300) })).status).toBe(400);
    expect((await put({ name: 5 })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses to modify a deleted project", async () => {
    (db.select as jest.Mock).mockReturnValue(project("deleted"));
    expect((await put({ name: "x" })).status).toBe(404);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("denies callers without project:update", async () => {
    (hasPermissionForUser as jest.Mock).mockResolvedValue(false);
    expect((await put({ name: "x" })).status).toBe(403);
  });
});
