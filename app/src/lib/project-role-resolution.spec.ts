/** @jest-environment node */
// The effective project role must be the LOWER of the org role and project_members.role,
// and must be identical on the dashboard session path, the project-id (permission context)
// path and the CLI token path. Org owners/admins keep their org-wide bypass.
jest.mock("next/headers", () => ({
  headers: jest.fn(async () => new Headers({ authorization: "Bearer sck_live_testcredential123456789" })),
}));
jest.mock("next/server", () => ({ NextResponse: { json: jest.fn() } }));
jest.mock("@/utils/auth", () => ({ auth: {} }));
jest.mock("@/utils/db", () => ({ db: { select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/session-cache", () => ({
  getCachedAuthSession: jest.fn(async () => ({ session: { token: "t" }, user: { id: "u" } })),
}));
jest.mock("@/lib/session", () => ({
  getActiveOrganization: jest.fn(async () => ({ id: "org" })),
}));
jest.mock("@/lib/rbac/unified-auth", () => ({ getUnifiedAuthContext: jest.fn() }));
jest.mock("@/lib/rbac/super-admin", () => ({ isSuperAdmin: jest.fn(async () => false) }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { db } from "@/utils/db";
import { getCurrentProjectContext } from "./project-context";
import { resolveProjectPermissionContext } from "./rbac/middleware";
import { requireAuthContext } from "./auth-context";
import { resolveEffectiveProjectRole } from "./rbac/effective-project-role";
import { Role } from "./rbac/permissions-client";

/** Every db.select() chain resolves the next queued result at .limit(). */
function queue(...results: unknown[][]) {
  const select = jest.mocked(db.select).mockReset();
  for (const r of results) {
    select.mockReturnValueOnce({
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(r),
    } as never);
  }
}

async function sessionRole(orgRole: string, memberRole: string | null) {
  queue(
    [{ activeProjectId: "p", activeOrganizationId: "org", userId: "u", impersonatedBy: null }],
    [{ id: "p", name: "P", slug: "p", organizationId: "org", isDefault: true }],
    [{ role: orgRole }],
    memberRole ? [{ role: memberRole }] : [],
  );
  return (await getCurrentProjectContext())?.userRole;
}

async function permissionRole(orgRole: string, memberRole: string | null) {
  queue(
    [{ id: "p", organizationId: "org" }],
    [{ role: orgRole }],
    memberRole ? [{ role: memberRole }] : [],
  );
  return (await resolveProjectPermissionContext("u", "p"))?.project.userRole;
}

async function cliRole(orgRole: string, memberRole: string | null) {
  queue(
    [{ id: "k", userId: "u", projectId: "p", permissions: '["cli:full"]' }],
    [{ projectId: "p", projectName: "P", projectOrgId: "org", orgRole, projectRole: memberRole }],
  );
  jest.mocked(db.update).mockReturnValue({
    set: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ execute: jest.fn() }) }),
  } as never);
  return (await requireAuthContext()).project.userRole;
}

const paths = [
  ["session (dashboard)", sessionRole],
  ["project-id permission context", permissionRole],
  ["CLI token", cliRole],
] as const;

const cases: [string, string, string | null, string][] = [
  ["demotion: org editor, project viewer", "project_editor", "project_viewer", "project_viewer"],
  ["demotion: org project_admin, project editor", "project_admin", "project_editor", "project_editor"],
  ["promotion ignored: org viewer, project admin", "project_viewer", "project_admin", "project_viewer"],
  ["promotion ignored: org editor, project admin", "project_editor", "project_admin", "project_editor"],
  ["no row: org editor", "project_editor", null, "project_viewer"],
  ["no row: org project_admin", "project_admin", null, "project_viewer"],
  ["no row: org viewer", "project_viewer", null, "project_viewer"],
  ["agreement: editor/editor", "project_editor", "project_editor", "project_editor"],
  ["org owner bypasses a viewer row", "org_owner", "project_viewer", "org_owner"],
  ["org admin bypasses a viewer row", "org_admin", "project_viewer", "org_admin"],
  ["org owner with no row", "org_owner", null, "org_owner"],
];

describe.each(paths)("effective project role on the %s path", (_name, resolve) => {
  it.each(cases)("%s", async (_label, orgRole, memberRole, expected) => {
    expect(await resolve(orgRole, memberRole)).toBe(expected);
  });
});

describe("resolveEffectiveProjectRole", () => {
  it("denies when there is no org role and fails closed on an unknown project role", () => {
    expect(resolveEffectiveProjectRole(null, "project_admin")).toBeNull();
    expect(resolveEffectiveProjectRole(Role.PROJECT_ADMIN, "bogus")).toBe(Role.PROJECT_VIEWER);
  });
});
