/**
 * Role Normalizer Tests
 * Tests for the comprehensive role normalization system
 */

import {
  normalizeRole,
  roleToString,
  roleToDisplayName,
  isNormalizedRole,
  getRoleHierarchyLevel,
  getHigherRole,
  normalizeRoles,
  findHighestRole,
  isValidRole,
} from "./role-normalizer";
import { Role } from "./permissions-client";

describe("Role Normalizer", () => {
  describe("normalizeRole", () => {
    describe("handles standard role strings", () => {
      it("should normalize super_admin to SUPER_ADMIN", () => {
        expect(normalizeRole("super_admin")).toBe(Role.SUPER_ADMIN);
      });

      it("should normalize org_owner to ORG_OWNER", () => {
        expect(normalizeRole("org_owner")).toBe(Role.ORG_OWNER);
      });

      it("should normalize org_admin to ORG_ADMIN", () => {
        expect(normalizeRole("org_admin")).toBe(Role.ORG_ADMIN);
      });

      it("should normalize project_admin to PROJECT_ADMIN", () => {
        expect(normalizeRole("project_admin")).toBe(Role.PROJECT_ADMIN);
      });

      it("should normalize project_editor to PROJECT_EDITOR", () => {
        expect(normalizeRole("project_editor")).toBe(Role.PROJECT_EDITOR);
      });

      it("should normalize project_viewer to PROJECT_VIEWER", () => {
        expect(normalizeRole("project_viewer")).toBe(Role.PROJECT_VIEWER);
      });
    });

    describe("handles case variations", () => {
      it("should normalize SUPER_ADMIN (uppercase)", () => {
        expect(normalizeRole("SUPER_ADMIN")).toBe(Role.SUPER_ADMIN);
      });

      it("should normalize Super_Admin (mixed case)", () => {
        expect(normalizeRole("Super_Admin")).toBe(Role.SUPER_ADMIN);
      });

      it("should normalize org_OWNER (mixed case)", () => {
        expect(normalizeRole("org_OWNER")).toBe(Role.ORG_OWNER);
      });
    });

    describe("handles Role enum values directly", () => {
      it("should return Role.SUPER_ADMIN unchanged", () => {
        expect(normalizeRole(Role.SUPER_ADMIN)).toBe(Role.SUPER_ADMIN);
      });

      it("should return Role.ORG_OWNER unchanged", () => {
        expect(normalizeRole(Role.ORG_OWNER)).toBe(Role.ORG_OWNER);
      });

      it("should return Role.PROJECT_VIEWER unchanged", () => {
        expect(normalizeRole(Role.PROJECT_VIEWER)).toBe(Role.PROJECT_VIEWER);
      });
    });

    describe("handles null and undefined", () => {
      it("should return PROJECT_VIEWER for null", () => {
        expect(normalizeRole(null)).toBe(Role.PROJECT_VIEWER);
      });

      it("should return PROJECT_VIEWER for undefined", () => {
        expect(normalizeRole(undefined)).toBe(Role.PROJECT_VIEWER);
      });
    });

    describe("handles unknown role strings", () => {
      it("should return PROJECT_VIEWER for unknown role", () => {
        // Suppress console.warn for this test
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        expect(normalizeRole("unknown_role")).toBe(Role.PROJECT_VIEWER);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });

      it("should return PROJECT_VIEWER for empty string", () => {
        const warnSpy = jest.spyOn(console, "warn").mockImplementation();
        expect(normalizeRole("")).toBe(Role.PROJECT_VIEWER);
        warnSpy.mockRestore();
      });
    });

    describe("handles whitespace", () => {
      it("should trim whitespace from role strings", () => {
        expect(normalizeRole("  super_admin  ")).toBe(Role.SUPER_ADMIN);
      });

      it("should handle tabs and newlines", () => {
        expect(normalizeRole("\torg_owner\n")).toBe(Role.ORG_OWNER);
      });
    });
  });

  describe("roleToString", () => {
    it("should convert SUPER_ADMIN to super_admin", () => {
      expect(roleToString(Role.SUPER_ADMIN)).toBe("super_admin");
    });

    it("should convert ORG_OWNER to org_owner", () => {
      expect(roleToString(Role.ORG_OWNER)).toBe("org_owner");
    });

    it("should convert ORG_ADMIN to org_admin", () => {
      expect(roleToString(Role.ORG_ADMIN)).toBe("org_admin");
    });

    it("should convert PROJECT_ADMIN to project_admin", () => {
      expect(roleToString(Role.PROJECT_ADMIN)).toBe("project_admin");
    });

    it("should convert PROJECT_EDITOR to project_editor", () => {
      expect(roleToString(Role.PROJECT_EDITOR)).toBe("project_editor");
    });

    it("should convert PROJECT_VIEWER to project_viewer", () => {
      expect(roleToString(Role.PROJECT_VIEWER)).toBe("project_viewer");
    });

    it("should return project_viewer for unknown role", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(roleToString("unknown" as Role)).toBe("project_viewer");
      warnSpy.mockRestore();
    });
  });

  describe("roleToDisplayName", () => {
    it('should return "Super Admin" for SUPER_ADMIN', () => {
      expect(roleToDisplayName(Role.SUPER_ADMIN)).toBe("Super Admin");
    });

    it('should return "Organization Owner" for ORG_OWNER', () => {
      expect(roleToDisplayName(Role.ORG_OWNER)).toBe("Organization Owner");
    });

    it('should return "Organization Admin" for ORG_ADMIN', () => {
      expect(roleToDisplayName(Role.ORG_ADMIN)).toBe("Organization Admin");
    });

    it('should return "Project Admin" for PROJECT_ADMIN', () => {
      expect(roleToDisplayName(Role.PROJECT_ADMIN)).toBe("Project Admin");
    });

    it('should return "Project Editor" for PROJECT_EDITOR', () => {
      expect(roleToDisplayName(Role.PROJECT_EDITOR)).toBe("Project Editor");
    });

    it('should return "Project Viewer" for PROJECT_VIEWER', () => {
      expect(roleToDisplayName(Role.PROJECT_VIEWER)).toBe("Project Viewer");
    });

    it('should return "Project Viewer" for unknown role', () => {
      expect(roleToDisplayName("unknown" as Role)).toBe("Project Viewer");
    });
  });

  describe("isNormalizedRole", () => {
    it("should return true for all valid role strings", () => {
      expect(isNormalizedRole("super_admin")).toBe(true);
      expect(isNormalizedRole("org_owner")).toBe(true);
      expect(isNormalizedRole("org_admin")).toBe(true);
      expect(isNormalizedRole("project_admin")).toBe(true);
      expect(isNormalizedRole("project_editor")).toBe(true);
      expect(isNormalizedRole("project_viewer")).toBe(true);
    });

    it("should return false for invalid role strings", () => {
      expect(isNormalizedRole("SUPER_ADMIN")).toBe(false);
      expect(isNormalizedRole("admin")).toBe(false);
      expect(isNormalizedRole("owner")).toBe(false);
      expect(isNormalizedRole("")).toBe(false);
    });
  });

  describe("getRoleHierarchyLevel", () => {
    it("should return 6 for SUPER_ADMIN (highest)", () => {
      expect(getRoleHierarchyLevel(Role.SUPER_ADMIN)).toBe(6);
    });

    it("should return 5 for ORG_OWNER", () => {
      expect(getRoleHierarchyLevel(Role.ORG_OWNER)).toBe(5);
    });

    it("should return 4 for ORG_ADMIN", () => {
      expect(getRoleHierarchyLevel(Role.ORG_ADMIN)).toBe(4);
    });

    it("should return 3 for PROJECT_ADMIN", () => {
      expect(getRoleHierarchyLevel(Role.PROJECT_ADMIN)).toBe(3);
    });

    it("should return 2 for PROJECT_EDITOR", () => {
      expect(getRoleHierarchyLevel(Role.PROJECT_EDITOR)).toBe(2);
    });

    it("should return 1 for PROJECT_VIEWER (lowest)", () => {
      expect(getRoleHierarchyLevel(Role.PROJECT_VIEWER)).toBe(1);
    });

    it("should return 0 for unknown role", () => {
      expect(getRoleHierarchyLevel("unknown" as Role)).toBe(0);
    });

    it("should maintain proper hierarchy order", () => {
      const levels = [
        getRoleHierarchyLevel(Role.PROJECT_VIEWER),
        getRoleHierarchyLevel(Role.PROJECT_EDITOR),
        getRoleHierarchyLevel(Role.PROJECT_ADMIN),
        getRoleHierarchyLevel(Role.ORG_ADMIN),
        getRoleHierarchyLevel(Role.ORG_OWNER),
        getRoleHierarchyLevel(Role.SUPER_ADMIN),
      ];
      // Verify ascending order
      for (let i = 0; i < levels.length - 1; i++) {
        expect(levels[i]).toBeLessThan(levels[i + 1]);
      }
    });
  });

  describe("getHigherRole", () => {
    it("should return SUPER_ADMIN when comparing with any role", () => {
      expect(getHigherRole(Role.SUPER_ADMIN, Role.ORG_OWNER)).toBe(
        Role.SUPER_ADMIN
      );
      expect(getHigherRole(Role.PROJECT_VIEWER, Role.SUPER_ADMIN)).toBe(
        Role.SUPER_ADMIN
      );
    });

    it("should return ORG_OWNER when comparing ORG_OWNER and ORG_ADMIN", () => {
      expect(getHigherRole(Role.ORG_OWNER, Role.ORG_ADMIN)).toBe(
        Role.ORG_OWNER
      );
      expect(getHigherRole(Role.ORG_ADMIN, Role.ORG_OWNER)).toBe(
        Role.ORG_OWNER
      );
    });

    it("should return first role when both are equal", () => {
      expect(getHigherRole(Role.PROJECT_EDITOR, Role.PROJECT_EDITOR)).toBe(
        Role.PROJECT_EDITOR
      );
    });

    it("should handle all combinations correctly", () => {
      expect(getHigherRole(Role.PROJECT_ADMIN, Role.PROJECT_EDITOR)).toBe(
        Role.PROJECT_ADMIN
      );
      expect(getHigherRole(Role.PROJECT_EDITOR, Role.PROJECT_VIEWER)).toBe(
        Role.PROJECT_EDITOR
      );
    });
  });

  describe("normalizeRoles", () => {
    it("should normalize an array of role strings", () => {
      const roles = normalizeRoles([
        "super_admin",
        "org_owner",
        "project_viewer",
      ]);
      expect(roles).toEqual([
        Role.SUPER_ADMIN,
        Role.ORG_OWNER,
        Role.PROJECT_VIEWER,
      ]);
    });

    it("should handle mixed input types", () => {
      const roles = normalizeRoles([
        Role.SUPER_ADMIN,
        "org_owner",
        null,
        undefined,
      ]);
      expect(roles).toEqual([
        Role.SUPER_ADMIN,
        Role.ORG_OWNER,
        Role.PROJECT_VIEWER,
        Role.PROJECT_VIEWER,
      ]);
    });

    it("should return empty array for empty input", () => {
      expect(normalizeRoles([])).toEqual([]);
    });
  });

  describe("findHighestRole", () => {
    it("should find SUPER_ADMIN as highest in mixed array", () => {
      const highest = findHighestRole([
        "project_viewer",
        "super_admin",
        "org_owner",
      ]);
      expect(highest).toBe(Role.SUPER_ADMIN);
    });

    it("should find ORG_OWNER when no SUPER_ADMIN present", () => {
      const highest = findHighestRole([
        "project_viewer",
        "org_owner",
        "org_admin",
      ]);
      expect(highest).toBe(Role.ORG_OWNER);
    });

    it("should return PROJECT_VIEWER for empty array", () => {
      expect(findHighestRole([])).toBe(Role.PROJECT_VIEWER);
    });

    it("should return PROJECT_VIEWER for array of nulls", () => {
      expect(findHighestRole([null, undefined])).toBe(Role.PROJECT_VIEWER);
    });

    it("should handle single element array", () => {
      expect(findHighestRole(["org_admin"])).toBe(Role.ORG_ADMIN);
    });
  });

  describe("isValidRole", () => {
    it("should return true for all Role enum values", () => {
      expect(isValidRole(Role.SUPER_ADMIN)).toBe(true);
      expect(isValidRole(Role.ORG_OWNER)).toBe(true);
      expect(isValidRole(Role.ORG_ADMIN)).toBe(true);
      expect(isValidRole(Role.PROJECT_ADMIN)).toBe(true);
      expect(isValidRole(Role.PROJECT_EDITOR)).toBe(true);
      expect(isValidRole(Role.PROJECT_VIEWER)).toBe(true);
    });

    it("should return false for non-Role values", () => {
      // Role enum values are strings, so 'super_admin' IS a valid Role
      expect(isValidRole("admin")).toBe(false);
      expect(isValidRole("owner")).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
      expect(isValidRole(123)).toBe(false);
      expect(isValidRole({})).toBe(false);
    });

    it("should return true for role string values that match enum", () => {
      // Since Role enum values are strings like 'super_admin', these should be valid
      expect(isValidRole("super_admin")).toBe(true);
      expect(isValidRole("org_owner")).toBe(true);
      expect(isValidRole("project_viewer")).toBe(true);
    });
  });

  describe("Edge Cases and Boundary Conditions", () => {
    it("should handle very long invalid strings gracefully", () => {
      const longString = "a".repeat(10000);
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole(longString)).toBe(Role.PROJECT_VIEWER);
      warnSpy.mockRestore();
    });

    it("should handle special characters in role strings", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole("super@admin")).toBe(Role.PROJECT_VIEWER);
      expect(normalizeRole("org-owner")).toBe(Role.PROJECT_VIEWER);
      expect(normalizeRole("project.admin")).toBe(Role.PROJECT_VIEWER);
      warnSpy.mockRestore();
    });

    it("should handle numeric input", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole(123 as unknown as string)).toBe(Role.PROJECT_VIEWER);
      expect(normalizeRole(0 as unknown as string)).toBe(Role.PROJECT_VIEWER);
      warnSpy.mockRestore();
    });

    it("should handle boolean input", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole(true as unknown as string)).toBe(
        Role.PROJECT_VIEWER
      );
      expect(normalizeRole(false as unknown as string)).toBe(
        Role.PROJECT_VIEWER
      );
      warnSpy.mockRestore();
    });

    it("should handle object input", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole({} as unknown as string)).toBe(Role.PROJECT_VIEWER);
      expect(normalizeRole({ role: "admin" } as unknown as string)).toBe(
        Role.PROJECT_VIEWER
      );
      warnSpy.mockRestore();
    });

    it("should handle array input", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole(["admin"] as unknown as string)).toBe(
        Role.PROJECT_VIEWER
      );
      warnSpy.mockRestore();
    });

    it("should handle unicode role strings", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole("管理员")).toBe(Role.PROJECT_VIEWER);
      expect(normalizeRole("αδμιν")).toBe(Role.PROJECT_VIEWER);
      warnSpy.mockRestore();
    });

    it("should handle SQL injection attempts in role strings", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();
      expect(normalizeRole("'; DROP TABLE users; --")).toBe(
        Role.PROJECT_VIEWER
      );
      expect(normalizeRole("1' OR '1'='1")).toBe(Role.PROJECT_VIEWER);
      warnSpy.mockRestore();
    });
  });
});
