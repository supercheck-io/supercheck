/**
 * Client-side permission helper tests.
 *
 * `client-permissions.ts` gates UI affordances in ~20 components. These tests
 * pin the current behaviour for every helper and role, and verify that the
 * client permission matrix stays in lock-step with the server-side roles.
 *
 * The parity checks below fail if the client switch/matrix or the server
 * statements drift apart, so UI affordances always match what the server
 * enforces.
 */

import {
  canCancelRuns,
  canCreateJobs,
  canCreateMonitors,
  canCreateNotifications,
  canCreateProjects,
  canCreateRequirements,
  canCreateStatusPages,
  canCreateTags,
  canCreateTests,
  canDeleteJobs,
  canDeleteMonitors,
  canDeleteOrganization,
  canDeleteProject,
  canDeleteRequirements,
  canDeleteResource,
  canDeleteResources,
  canDeleteRuns,
  canDeleteStatusPages,
  canDeleteTags,
  canDeleteTests,
  canEditJobs,
  canEditMonitors,
  canEditRequirements,
  canEditResources,
  canEditStatusPages,
  canEditTests,
  canExportResults,
  canInviteMembers,
  canInvestigateSre,
  canManageAPIKeys,
  canManageMembers,
  canManageNotifications,
  canManageOrganization,
  canManageProject,
  canManageRuns,
  canManageStatusPages,
  canRemoveMembers,
  canRunTests,
  canTriggerJobs,
  canUseSreLiveConnectorTools,
  canViewAPIKeys,
  hasOrganizationWideAccess,
  hasPermission,
  isProjectLimitedRole,
} from "./client-permissions";
import {
  checkRolePermissionsClient,
  rolePermissions,
  Role,
} from "./permissions-client";
import { checkRolePermissions, statement } from "./permissions";

const ALL_ROLES = [
  Role.SUPER_ADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
  Role.PROJECT_ADMIN,
  Role.PROJECT_EDITOR,
  Role.PROJECT_VIEWER,
] as const;

/** Roles with organisation-wide access to every resource action. */
const FULL_ACCESS_ROLES = [
  Role.SUPER_ADMIN,
  Role.ORG_OWNER,
  Role.ORG_ADMIN,
] as const;

type HelperCase = {
  name: string;
  run: (role: Role) => boolean;
  /** Expected value per role — pins current client behaviour. */
  expected: Record<Role, boolean>;
};

/** Every role except viewers. */
const ALL_BUT_VIEWER = {
  [Role.SUPER_ADMIN]: true,
  [Role.ORG_OWNER]: true,
  [Role.ORG_ADMIN]: true,
  [Role.PROJECT_ADMIN]: true,
  [Role.PROJECT_EDITOR]: true,
  [Role.PROJECT_VIEWER]: false,
} as const satisfies Record<Role, boolean>;

/** Admin tier plus project admins (destructive project actions). */
const ADMIN_AND_PROJECT_ADMIN = {
  [Role.SUPER_ADMIN]: true,
  [Role.ORG_OWNER]: true,
  [Role.ORG_ADMIN]: true,
  [Role.PROJECT_ADMIN]: true,
  [Role.PROJECT_EDITOR]: false,
  [Role.PROJECT_VIEWER]: false,
} as const satisfies Record<Role, boolean>;

/** Admin tier only (org-wide actions). */
const ADMIN_ONLY = {
  [Role.SUPER_ADMIN]: true,
  [Role.ORG_OWNER]: true,
  [Role.ORG_ADMIN]: true,
  [Role.PROJECT_ADMIN]: false,
  [Role.PROJECT_EDITOR]: false,
  [Role.PROJECT_VIEWER]: false,
} as const satisfies Record<Role, boolean>;

const HELPER_CASES: HelperCase[] = [
  {
    name: "canEditJobs",
    run: canEditJobs,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteJobs",
    run: canDeleteJobs,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canTriggerJobs",
    run: canTriggerJobs,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canCreateJobs",
    run: canCreateJobs,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canEditTests",
    run: canEditTests,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteTests",
    run: canDeleteTests,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canRunTests",
    run: canRunTests,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canCreateTests",
    run: canCreateTests,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canEditMonitors",
    run: canEditMonitors,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteMonitors",
    run: canDeleteMonitors,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canCreateMonitors",
    run: canCreateMonitors,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canManageOrganization",
    run: canManageOrganization,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: true,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canDeleteOrganization",
    run: canDeleteOrganization,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: false,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canInviteMembers",
    run: canInviteMembers,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: true,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canRemoveMembers",
    run: canRemoveMembers,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: true,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canManageMembers",
    run: canManageMembers,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: true,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canCreateProjects",
    run: canCreateProjects,
    expected: {
      [Role.SUPER_ADMIN]: true,
      [Role.ORG_OWNER]: true,
      [Role.ORG_ADMIN]: true,
      [Role.PROJECT_ADMIN]: false,
      [Role.PROJECT_EDITOR]: false,
      [Role.PROJECT_VIEWER]: false,
    },
  },
  {
    name: "canDeleteProject",
    run: canDeleteProject,
    expected: { ...ADMIN_ONLY },
  },
  {
    name: "canManageProject",
    run: canManageProject,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canViewAPIKeys",
    run: canViewAPIKeys,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canManageAPIKeys",
    run: canManageAPIKeys,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteRuns",
    run: canDeleteRuns,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canCancelRuns",
    run: canCancelRuns,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canManageRuns",
    run: canManageRuns,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canExportResults",
    run: canExportResults,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canCreateTags",
    run: canCreateTags,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteTags",
    run: canDeleteTags,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canCreateNotifications",
    run: canCreateNotifications,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canManageNotifications",
    run: canManageNotifications,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canCreateStatusPages",
    run: canCreateStatusPages,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canEditStatusPages",
    run: canEditStatusPages,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteStatusPages",
    run: canDeleteStatusPages,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canManageStatusPages",
    run: canManageStatusPages,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canCreateRequirements",
    run: canCreateRequirements,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canEditRequirements",
    run: canEditRequirements,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canDeleteRequirements",
    run: canDeleteRequirements,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
  {
    name: "canInvestigateSre",
    run: canInvestigateSre,
    expected: { ...ALL_BUT_VIEWER },
  },
  {
    name: "canUseSreLiveConnectorTools",
    run: canUseSreLiveConnectorTools,
    expected: { ...ADMIN_AND_PROJECT_ADMIN },
  },
];

describe("client-permissions", () => {
  describe("hasPermission", () => {
    it("grants super admin every resource action", () => {
      expect(hasPermission(Role.SUPER_ADMIN, "test", "delete")).toBe(true);
      expect(hasPermission(Role.SUPER_ADMIN, "system", "manage_users")).toBe(
        true,
      );
      expect(hasPermission(Role.SUPER_ADMIN, "anything", "anything")).toBe(
        true,
      );
    });

    it.each(FULL_ACCESS_ROLES)(
      "denies system resources to %s (except super admin)",
      (role) => {
        const expected = role === Role.SUPER_ADMIN;

        expect(hasPermission(role, "system", "manage_users")).toBe(expected);
        expect(hasPermission(role, "system", "view_stats")).toBe(expected);
      },
    );

    it("prevents org admins from deleting the organization", () => {
      expect(hasPermission(Role.ORG_ADMIN, "organization", "delete")).toBe(
        false,
      );
      expect(hasPermission(Role.ORG_OWNER, "organization", "delete")).toBe(
        true,
      );
    });

    it("gives project admins full control over assigned project resources", () => {
      expect(hasPermission(Role.PROJECT_ADMIN, "test", "delete")).toBe(true);
      expect(hasPermission(Role.PROJECT_ADMIN, "monitor", "manage")).toBe(true);
      expect(hasPermission(Role.PROJECT_ADMIN, "status_page", "delete")).toBe(
        true,
      );
    });

    it("limits project editors to non-destructive actions", () => {
      expect(hasPermission(Role.PROJECT_EDITOR, "test", "update")).toBe(true);
      expect(hasPermission(Role.PROJECT_EDITOR, "test", "run")).toBe(true);
      expect(hasPermission(Role.PROJECT_EDITOR, "test", "delete")).toBe(false);
      expect(hasPermission(Role.PROJECT_EDITOR, "monitor", "delete")).toBe(
        false,
      );
      expect(hasPermission(Role.PROJECT_EDITOR, "run", "cancel")).toBe(true);
      expect(hasPermission(Role.PROJECT_EDITOR, "run", "delete")).toBe(false);
    });

    it("denies editor access to SRE connector tooling", () => {
      expect(
        hasPermission(Role.PROJECT_EDITOR, "sre_connector", "view"),
      ).toBe(true);
      expect(
        hasPermission(Role.PROJECT_EDITOR, "sre_connector", "investigate"),
      ).toBe(false);
    });

    it("gives viewers read-only access", () => {
      expect(hasPermission(Role.PROJECT_VIEWER, "test", "view")).toBe(true);
      expect(hasPermission(Role.PROJECT_VIEWER, "test", "run")).toBe(false);
      expect(hasPermission(Role.PROJECT_VIEWER, "test", "create")).toBe(false);
    });

    it("keeps API keys hidden from viewers", () => {
      expect(hasPermission(Role.PROJECT_VIEWER, "apiKey", "view")).toBe(false);
      expect(hasPermission(Role.PROJECT_EDITOR, "apiKey", "view")).toBe(true);
    });

    it("prevents org admins from creating organizations", () => {
      expect(hasPermission(Role.ORG_ADMIN, "organization", "create")).toBe(
        false,
      );
      expect(hasPermission(Role.ORG_ADMIN, "organization", "update")).toBe(
        true,
      );
      expect(hasPermission(Role.ORG_OWNER, "organization", "create")).toBe(
        true,
      );
    });

    it("lets project admins manage variables and project settings", () => {
      expect(hasPermission(Role.PROJECT_ADMIN, "variable", "delete")).toBe(
        true,
      );
      expect(hasPermission(Role.PROJECT_ADMIN, "variable", "view_secrets")).toBe(
        true,
      );
      expect(hasPermission(Role.PROJECT_ADMIN, "project", "update")).toBe(true);
    });

    it("lets project editors manage variables without deleting them", () => {
      expect(hasPermission(Role.PROJECT_EDITOR, "variable", "create")).toBe(
        true,
      );
      expect(hasPermission(Role.PROJECT_EDITOR, "variable", "update")).toBe(
        true,
      );
      expect(hasPermission(Role.PROJECT_EDITOR, "variable", "delete")).toBe(
        false,
      );
    });

    it("denies unknown roles", () => {
      expect(hasPermission("not_a_role" as Role, "test", "view")).toBe(false);
      expect(hasPermission(undefined as unknown as Role, "test", "view")).toBe(
        false,
      );
    });
  });

  describe("helper functions", () => {
    describe.each(HELPER_CASES)("$name", ({ run, expected }) => {
      for (const role of ALL_ROLES) {
        it(`returns ${expected[role]} for ${role}`, () => {
          expect(run(role)).toBe(expected[role]);
        });
      }
    });
  });

  describe("role scope helpers", () => {
    it.each([
      [Role.SUPER_ADMIN, true],
      [Role.ORG_OWNER, true],
      [Role.ORG_ADMIN, true],
      [Role.PROJECT_ADMIN, false],
      [Role.PROJECT_EDITOR, false],
      [Role.PROJECT_VIEWER, true],
    ])("hasOrganizationWideAccess(%s) === %s", (role, expected) => {
      expect(hasOrganizationWideAccess(role)).toBe(expected);
    });

    it.each([
      [Role.SUPER_ADMIN, false],
      [Role.ORG_OWNER, false],
      [Role.ORG_ADMIN, false],
      [Role.PROJECT_ADMIN, true],
      [Role.PROJECT_EDITOR, true],
      [Role.PROJECT_VIEWER, false],
    ])("isProjectLimitedRole(%s) === %s", (role, expected) => {
      expect(isProjectLimitedRole(role)).toBe(expected);
    });

    it("allows every role except viewers to edit resources", () => {
      for (const role of ALL_ROLES) {
        expect(canEditResources(role)).toBe(role !== Role.PROJECT_VIEWER);
      }
    });

    it("only allows admin-tier roles to delete resources", () => {
      for (const role of ALL_ROLES) {
        const expected = (
          [
            Role.SUPER_ADMIN,
            Role.ORG_OWNER,
            Role.ORG_ADMIN,
            Role.PROJECT_ADMIN,
          ] as Role[]
        ).includes(role);

        expect(canDeleteResources(role)).toBe(expected);
      }
    });
  });

  describe("canDeleteResource (context-aware)", () => {
    const baseContext = { userId: "user-1" };

    it.each(FULL_ACCESS_ROLES)(
      "allows %s to delete regardless of project assignment",
      (role) => {
        expect(
          canDeleteResource({ ...baseContext, role }, "test"),
        ).toBe(true);
        expect(
          canDeleteResource(
            { ...baseContext, role, isAssignedProject: false },
            "test",
          ),
        ).toBe(true);
      },
    );

    it("allows project admins to delete only inside assigned projects", () => {
      const context = { ...baseContext, role: Role.PROJECT_ADMIN };

      expect(
        canDeleteResource({ ...context, isAssignedProject: true }, "test"),
      ).toBe(true);
      expect(
        canDeleteResource({ ...context, isAssignedProject: false }, "test"),
      ).toBe(false);
      expect(canDeleteResource(context, "test")).toBe(false);
    });

    it("never allows project editors to delete", () => {
      expect(
        canDeleteResource(
          {
            ...baseContext,
            role: Role.PROJECT_EDITOR,
            isAssignedProject: true,
            resourceCreatorId: "user-1",
          },
          "test",
        ),
      ).toBe(false);
    });

    it("never allows viewers to delete", () => {
      expect(
        canDeleteResource(
          {
            ...baseContext,
            role: Role.PROJECT_VIEWER,
            isAssignedProject: true,
          },
          "test",
        ),
      ).toBe(false);
    });
  });

  describe("parity with the role matrix", () => {
    it("client hasPermission matches the role matrix for every role/resource/action", () => {
      const divergences: string[] = [];

      for (const role of ALL_ROLES) {
        for (const [resource, actions] of Object.entries(statement)) {
          for (const action of actions as readonly string[]) {
            const client = hasPermission(role, resource, action);
            const matrix = checkRolePermissionsClient(role, {
              [resource]: [action],
            });

            if (client !== matrix) {
              divergences.push(`${role} ${resource} ${action}`);
            }
          }
        }
      }

      expect(divergences).toEqual([]);
    });

    it("keeps permissions-client matrix aligned with the server matrix", () => {
      const divergences: string[] = [];

      for (const role of ALL_ROLES) {
        for (const [resource, actions] of Object.entries(statement)) {
          for (const action of actions as readonly string[]) {
            const client = checkRolePermissionsClient(role, {
              [resource]: [action],
            });
            const server = checkRolePermissions(role, {
              [resource]: [action],
            });

            if (client !== server) {
              divergences.push(`${role} ${resource} ${action}`);
            }
          }
        }
      }

      expect(divergences).toEqual([]);
    });

    it("covers every role and resource in the matrix", () => {
      for (const role of ALL_ROLES) {
        expect(rolePermissions[role]).toBeDefined();
      }
      expect(Object.keys(statement)).toContain("sre_connector");
      expect(Object.keys(statement)).toContain("variable");
    });
  });
});
