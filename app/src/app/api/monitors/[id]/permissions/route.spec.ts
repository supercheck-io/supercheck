/** @jest-environment node */
const findFirst = jest.fn();
jest.mock("@/utils/db", () => ({ db: { query: { monitors: { findFirst: (...a: unknown[]) => findFirst(...a) } } } }));
jest.mock("@/db/schema", () => ({ monitors: {} }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn() }));
const mockStanding = { value: true };
jest.mock("@/lib/rbac/middleware", () => ({
  hasPermissionForUser: jest.fn(),
  // Stands in for the real helper: 403 for an org member, 404 for a caller with no standing in the org.
  forbiddenOrNotFound: jest.fn(async (_u: string, _o: string, forbidden: string, notFound: string) => {
    const { NextResponse } = jest.requireActual("next/server");
    return mockStanding.value ? NextResponse.json({ error: forbidden }, { status: 403 }) : NextResponse.json({ error: notFound }, { status: 404 });
  }),
}));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn() }));
jest.mock("@/lib/session", () => ({ getUserProjectRole: jest.fn() }));
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
import { hasPermissionForUser } from "@/lib/rbac/middleware";
import { isSuperAdmin } from "@/lib/rbac/super-admin";
import { getUserProjectRole } from "@/lib/session";

const call = () =>
  GET(new NextRequest("http://localhost/api/monitors/x/permissions"), {
    params: Promise.resolve({ id: "018f0000-0000-7000-8000-000000000001" }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockStanding.value = true;
  findFirst.mockResolvedValue({ organizationId: "o1", projectId: "p1" });
  jest.mocked(isSuperAdmin).mockResolvedValue(false);
  jest.mocked(getUserProjectRole).mockResolvedValue("project_editor" as never);
});

describe("GET /api/monitors/[id]/permissions", () => {
  it("reports super_admin, matching the granted flags, for a super admin without membership", async () => {
    jest.mocked(isSuperAdmin).mockResolvedValue(true);
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    const body = await (await call()).json();
    expect(body.data).toMatchObject({ userRole: "super_admin", canEdit: true, canDelete: true });
    expect(getUserProjectRole).not.toHaveBeenCalled();
  });

  it("reports the project role for an ordinary member", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(true);
    expect((await (await call()).json()).data.userRole).toBe("project_editor");
  });

  it("answers 403 to an organization member without view and 404 to another tenant", async () => {
    jest.mocked(hasPermissionForUser).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    mockStanding.value = false;
    expect((await call()).status).toBe(404);
  });

  it("answers 404, like a missing monitor, for a row with no organization or project", async () => {
    findFirst.mockResolvedValue({ organizationId: null, projectId: "p1" });
    expect((await call()).status).toBe(404);
    expect(hasPermissionForUser).not.toHaveBeenCalled();
  });
});
