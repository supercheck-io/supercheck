/** @jest-environment node */
import { NextRequest } from "next/server";
jest.mock("@/lib/auth-context", () => ({ requireUserAuthContext: jest.fn(), isAuthError: jest.fn(() => false), authErrorStatus: jest.fn(() => 401) }));
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn(),
  forbiddenOrNotFound: jest.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })),
}));
const mockRows = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => mockRows() }) }) }) } }));
jest.mock("@/lib/deletion/project", () => {
  class ProjectDeletionError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) { super(message); }
  }
  return { ProjectDeletionError, restoreProject: jest.fn() };
});
import { requireUserAuthContext } from "@/lib/auth-context";
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { restoreProject } from "@/lib/deletion/project";
import { POST } from "./route";

const ID = "93ce4a2e-7846-5b60-b753-1ab3563f0fce";
const call = (origin = "https://app.supercheck.io") =>
  POST(new NextRequest(`https://app.supercheck.io/api/projects/${ID}/restore`, { method: "POST", headers: { origin } }), { params: Promise.resolve({ id: ID }) });

describe("restore project", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireUserAuthContext as jest.Mock).mockResolvedValue({ userId: "u", isCliAuth: false });
    mockRows.mockResolvedValue([{ organizationId: "org-1", status: "deleted" }]);
    (hasPermissionForUser as jest.Mock).mockResolvedValue(true);
  });

  it("restores for someone who may delete projects (owners and admins)", async () => {
    expect((await call()).status).toBe(200);
    expect(hasPermissionForUser).toHaveBeenCalledWith("u", "project", "delete", { organizationId: "org-1" });
    expect(restoreProject).toHaveBeenCalledWith({ projectId: ID, actorUserId: "u" });
  });

  it("refuses without permission, cross-origin and CLI tokens, and 404s a project that is not deleted", async () => {
    (hasPermissionForUser as jest.Mock).mockResolvedValueOnce(false);
    expect((await call()).status).toBe(403);
    expect((await call("https://foreign.example")).status).toBe(403);
    (requireUserAuthContext as jest.Mock).mockResolvedValueOnce({ userId: "u", isCliAuth: true });
    expect((await call()).status).toBe(403);
    mockRows.mockResolvedValueOnce([{ organizationId: "org-1", status: "active" }]);
    expect((await call()).status).toBe(404);
    expect(restoreProject).not.toHaveBeenCalled();
  });

  it("reports an ended restore window", async () => {
    const { ProjectDeletionError } = jest.requireMock("@/lib/deletion/project");
    (restoreProject as jest.Mock).mockRejectedValueOnce(new ProjectDeletionError("ended", 409, "RESTORE_WINDOW_ENDED"));
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "RESTORE_WINDOW_ENDED" });
  });
});
