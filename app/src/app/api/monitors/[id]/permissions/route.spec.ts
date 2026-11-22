/** @jest-environment node */
const findFirst = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
jest.mock("@/db/schema", () => ({ monitors: {} }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn(), and: jest.fn(), isNull: jest.fn() }));
const mockStanding = { value: true };
jest.mock("@/lib/rbac/middleware", () => ({
  resolveProjectPermissionContext: jest.fn(),
  // A viewer may only view; any other role passed here may do everything.
  checkPermissionWithContext: jest.fn(
    (_r: string, action: string, ctx: { project: { userRole: string } }) =>
      action === "view" || ctx.project.userRole !== "project_viewer",
  ),
  // Stands in for the real helper: 403 for an org member, 404 for a caller with no standing in the org.
  forbiddenOrNotFound: jest.fn(async (_u: string, _o: string, forbidden: string, notFound: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return mockStanding.value ? NextResponse.json({ error: forbidden }, { status: 403 }) : NextResponse.json({ error: notFound }, { status: 404 });
  }),
}));
jest.mock("@/lib/auth-context", () => ({
  requireUserAuthContext: jest.fn().mockResolvedValue({ userId: "u1", projectId: "p1", isCliAuth: false }),
  isAuthError: () => false,
  authErrorStatus: () => 401,
}));
jest.mock("@/lib/logger/index", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";
import { resolveProjectPermissionContext } from "@/lib/rbac/middleware";

const ctx = (userRole: string) =>
  ({ userId: "u1", organizationId: "o1", orgPendingDeletion: false, project: { id: "p1", userRole } }) as never;

const call = () =>
  GET(new NextRequest("http://localhost/api/monitors/x/permissions"), {
    params: Promise.resolve({ id: "018f0000-0000-7000-8000-000000000001" }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockStanding.value = true;
  findFirst.mockResolvedValue({ organizationId: "o1", projectId: "p1" });
  jest.mocked(resolveProjectPermissionContext).mockResolvedValue(ctx("project_editor"));
});

describe("GET /api/monitors/[id]/permissions", () => {
  it("reports super_admin, matching the granted flags, for a super admin without membership", async () => {
    jest.mocked(resolveProjectPermissionContext).mockResolvedValue(ctx("super_admin"));
    const body = await (await call()).json();
    expect(body.data).toMatchObject({ userRole: "super_admin", canEdit: true, canDelete: true });
    // One role resolution for every flag (it used to be one per flag).
    expect(resolveProjectPermissionContext).toHaveBeenCalledTimes(1);
    expect(resolveProjectPermissionContext).toHaveBeenCalledWith("u1", "p1");
  });

  it("reports the project role for an ordinary member", async () => {
    expect((await (await call()).json()).data.userRole).toBe("project_editor");
  });

  it("grants a viewer view only", async () => {
    jest.mocked(resolveProjectPermissionContext).mockResolvedValue(ctx("project_viewer"));
    expect((await (await call()).json()).data).toMatchObject({
      userRole: "project_viewer",
      canEdit: false,
      canDelete: false,
      canToggle: false,
    });
  });

  it("answers 403 to an organization member without view and 404 to another tenant", async () => {
    jest.mocked(resolveProjectPermissionContext).mockResolvedValue(null);
    expect((await call()).status).toBe(403);
    mockStanding.value = false;
    expect((await call()).status).toBe(404);
  });

  it("answers 404, like a missing monitor, for a row with no organization or project", async () => {
    findFirst.mockResolvedValue({ organizationId: null, projectId: "p1" });
    expect((await call()).status).toBe(404);
    expect(resolveProjectPermissionContext).not.toHaveBeenCalled();
  });
});
