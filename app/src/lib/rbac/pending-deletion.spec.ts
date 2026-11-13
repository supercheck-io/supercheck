/** @jest-environment node */
import { Role, hasPermission, PENDING_DELETION_ALLOWED_ACTIONS, statement } from "./permissions";

const ROLES = [Role.SUPER_ADMIN, Role.ORG_OWNER, Role.ORG_ADMIN, Role.PROJECT_ADMIN, Role.PROJECT_EDITOR, Role.PROJECT_VIEWER];
const context = (role: Role, orgPendingDeletion: boolean) => ({ userId: "u", role, organizationId: "o", projectId: "p", assignedProjectIds: ["p"], orgPendingDeletion });

describe("pending organization deletion in the permission layer", () => {
  it("lets exactly view, view_secrets and export through", () => {
    expect([...PENDING_DELETION_ALLOWED_ACTIONS].sort()).toEqual(["export", "view", "view_secrets"]);
  });

  it.each(ROLES)("%s: every non-read action on every resource is denied while pending", (role) => {
    for (const [resource, actions] of Object.entries(statement)) {
      for (const action of actions as readonly string[]) {
        if (PENDING_DELETION_ALLOWED_ACTIONS.has(action)) continue;
        expect({ resource, action, allowed: hasPermission(context(role, true), resource as keyof typeof statement, action) }).toEqual({ resource, action, allowed: false });
      }
    }
  });

  it("super admins are read-only too (checked before the super admin shortcut)", () => {
    expect(hasPermission(context(Role.SUPER_ADMIN, true), "test", "run")).toBe(false);
    expect(hasPermission(context(Role.SUPER_ADMIN, true), "job", "trigger")).toBe(false);
    expect(hasPermission(context(Role.SUPER_ADMIN, false), "job", "trigger")).toBe(true);
  });

  it("views and exports stay allowed for roles that had them", () => {
    expect(hasPermission(context(Role.ORG_OWNER, true), "test", "view")).toBe(true);
    expect(hasPermission(context(Role.PROJECT_VIEWER, true), "run", "view")).toBe(true);
    expect(hasPermission(context(Role.ORG_ADMIN, true), "run", "export")).toBe(true);
    expect(hasPermission(context(Role.PROJECT_VIEWER, true), "variable", "view_secrets")).toBe(hasPermission(context(Role.PROJECT_VIEWER, false), "variable", "view_secrets"));
  });

  it("blocks invitations, API keys and member changes while pending, and allows them otherwise", () => {
    for (const [resource, action] of [["invitation", "create"], ["apiKey", "create"], ["member", "update"], ["project", "create"]] as const) {
      expect(hasPermission(context(Role.ORG_OWNER, true), resource, action)).toBe(false);
      expect(hasPermission(context(Role.ORG_OWNER, false), resource, action)).toBe(true);
    }
  });

  it("an organization that is not pending behaves exactly as before, flag absent or false", () => {
    const base = { userId: "u", role: Role.ORG_OWNER, organizationId: "o", projectId: "p", assignedProjectIds: ["p"] };
    expect(hasPermission(base, "test", "run")).toBe(true);
    expect(hasPermission({ ...base, orgPendingDeletion: false }, "test", "run")).toBe(true);
  });
});
