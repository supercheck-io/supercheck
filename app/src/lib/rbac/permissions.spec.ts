/**
 * RBAC Permissions Tests
 * Tests for the role-based access control permission system
 */

import {
  Role,
  statement,
  hasPermission,
  hasOrganizationWideAccess,
  isProjectLimitedRole,
  canEditResources,
  canDeleteResources,
  checkRolePermissions,
  PermissionContext,
} from './permissions';

describe('RBAC Permissions', () => {
  describe('Role enum', () => {
    it('should have all 6 roles defined', () => {
      expect(Role.SUPER_ADMIN).toBe('super_admin');
      expect(Role.ORG_OWNER).toBe('org_owner');
      expect(Role.ORG_ADMIN).toBe('org_admin');
      expect(Role.PROJECT_ADMIN).toBe('project_admin');
      expect(Role.PROJECT_EDITOR).toBe('project_editor');
      expect(Role.PROJECT_VIEWER).toBe('project_viewer');
    });
  });

  describe('statement definitions', () => {
    it('should define system permissions', () => {
      expect(statement.system).toContain('manage_users');
      expect(statement.system).toContain('view_users');
      expect(statement.system).toContain('impersonate_users');
      expect(statement.system).toContain('manage_organizations');
    });

    it('should define organization permissions', () => {
      expect(statement.organization).toContain('create');
      expect(statement.organization).toContain('update');
      expect(statement.organization).toContain('delete');
      expect(statement.organization).toContain('view');
    });

    it('should define project permissions', () => {
      expect(statement.project).toContain('create');
      expect(statement.project).toContain('update');
      expect(statement.project).toContain('delete');
      expect(statement.project).toContain('view');
      expect(statement.project).toContain('manage_members');
    });

    it('should define test permissions', () => {
      expect(statement.test).toContain('create');
      expect(statement.test).toContain('update');
      expect(statement.test).toContain('delete');
      expect(statement.test).toContain('view');
      expect(statement.test).toContain('run');
    });

    it('should define variable permissions including view_secrets', () => {
      expect(statement.variable).toContain('create');
      expect(statement.variable).toContain('update');
      expect(statement.variable).toContain('delete');
      expect(statement.variable).toContain('view');
      expect(statement.variable).toContain('view_secrets');
    });
  });

  describe('hasPermission', () => {
    describe('SUPER_ADMIN permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.SUPER_ADMIN,
      };

      it('should have access to all system permissions', () => {
        expect(hasPermission(context, 'system', 'manage_users')).toBe(true);
        expect(hasPermission(context, 'system', 'impersonate_users')).toBe(true);
        expect(hasPermission(context, 'system', 'manage_organizations')).toBe(true);
      });

      it('should have access to all organization permissions', () => {
        expect(hasPermission(context, 'organization', 'create')).toBe(true);
        expect(hasPermission(context, 'organization', 'delete')).toBe(true);
      });

      it('should have access to all project permissions', () => {
        expect(hasPermission(context, 'project', 'create')).toBe(true);
        expect(hasPermission(context, 'project', 'delete')).toBe(true);
      });

      it('should have access to all test permissions', () => {
        expect(hasPermission(context, 'test', 'create')).toBe(true);
        expect(hasPermission(context, 'test', 'delete')).toBe(true);
        expect(hasPermission(context, 'test', 'run')).toBe(true);
      });

      it('should have access to variable secrets', () => {
        expect(hasPermission(context, 'variable', 'view_secrets')).toBe(true);
      });
    });

    describe('ORG_OWNER permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.ORG_OWNER,
      };

      it('should NOT have system permissions', () => {
        expect(hasPermission(context, 'system', 'manage_users')).toBe(false);
        expect(hasPermission(context, 'system', 'impersonate_users')).toBe(false);
      });

      it('should have full organization permissions', () => {
        expect(hasPermission(context, 'organization', 'create')).toBe(true);
        expect(hasPermission(context, 'organization', 'update')).toBe(true);
        expect(hasPermission(context, 'organization', 'delete')).toBe(true);
      });

      it('should have full project permissions', () => {
        expect(hasPermission(context, 'project', 'create')).toBe(true);
        expect(hasPermission(context, 'project', 'delete')).toBe(true);
        expect(hasPermission(context, 'project', 'manage_members')).toBe(true);
      });

      it('should have full test permissions', () => {
        expect(hasPermission(context, 'test', 'create')).toBe(true);
        expect(hasPermission(context, 'test', 'update')).toBe(true);
        expect(hasPermission(context, 'test', 'delete')).toBe(true);
        expect(hasPermission(context, 'test', 'run')).toBe(true);
      });
    });

    describe('ORG_ADMIN permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.ORG_ADMIN,
      };

      it('should NOT be able to delete organization', () => {
        expect(hasPermission(context, 'organization', 'delete')).toBe(false);
      });

      it('should be able to update organization', () => {
        expect(hasPermission(context, 'organization', 'update')).toBe(true);
      });

      it('should have full project permissions', () => {
        expect(hasPermission(context, 'project', 'create')).toBe(true);
        expect(hasPermission(context, 'project', 'delete')).toBe(true);
      });

      it('should have member management permissions', () => {
        expect(hasPermission(context, 'member', 'create')).toBe(true);
        expect(hasPermission(context, 'member', 'delete')).toBe(true);
      });
    });

    describe('PROJECT_ADMIN permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: 'project-1',
        assignedProjectIds: ['project-1'],
      };

      it('should NOT be able to create projects', () => {
        expect(hasPermission(context, 'project', 'create')).toBe(false);
      });

      it('should be able to manage project members', () => {
        expect(hasPermission(context, 'project', 'manage_members')).toBe(true);
      });

      it('should have full test permissions in assigned projects', () => {
        expect(hasPermission(context, 'test', 'create')).toBe(true);
        expect(hasPermission(context, 'test', 'delete')).toBe(true);
        expect(hasPermission(context, 'test', 'run')).toBe(true);
      });

      it('should have full variable permissions in assigned projects', () => {
        expect(hasPermission(context, 'variable', 'create')).toBe(true);
        expect(hasPermission(context, 'variable', 'delete')).toBe(true);
        expect(hasPermission(context, 'variable', 'view_secrets')).toBe(true);
      });
    });

    describe('PROJECT_ADMIN in non-assigned projects', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: 'project-2',
        assignedProjectIds: ['project-1'], // NOT assigned to project-2
      };

      it('should only have view access to non-assigned projects', () => {
        expect(hasPermission(context, 'test', 'view')).toBe(true);
        expect(hasPermission(context, 'test', 'create')).toBe(false);
        expect(hasPermission(context, 'test', 'delete')).toBe(false);
      });
    });

    describe('PROJECT_EDITOR permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_EDITOR,
        projectId: 'project-1',
        assignedProjectIds: ['project-1'],
      };

      it('should be able to create and update tests', () => {
        expect(hasPermission(context, 'test', 'create')).toBe(true);
        expect(hasPermission(context, 'test', 'update')).toBe(true);
        expect(hasPermission(context, 'test', 'run')).toBe(true);
      });

      it('should NOT be able to delete any resources', () => {
        expect(hasPermission(context, 'test', 'delete')).toBe(false);
        expect(hasPermission(context, 'job', 'delete')).toBe(false);
        expect(hasPermission(context, 'monitor', 'delete')).toBe(false);
        expect(hasPermission(context, 'variable', 'delete')).toBe(false);
      });

      it('should be able to view but not edit variables', () => {
        expect(hasPermission(context, 'variable', 'view')).toBe(true);
      });

      it('should NOT be able to create or modify projects', () => {
        expect(hasPermission(context, 'project', 'create')).toBe(false);
        expect(hasPermission(context, 'project', 'update')).toBe(false);
      });
    });

    describe('PROJECT_VIEWER permissions', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_VIEWER,
      };

      it('should only have view permissions', () => {
        expect(hasPermission(context, 'test', 'view')).toBe(true);
        expect(hasPermission(context, 'job', 'view')).toBe(true);
        expect(hasPermission(context, 'monitor', 'view')).toBe(true);
        expect(hasPermission(context, 'project', 'view')).toBe(true);
      });

      it('should NOT have create permissions', () => {
        expect(hasPermission(context, 'test', 'create')).toBe(false);
        expect(hasPermission(context, 'job', 'create')).toBe(false);
        expect(hasPermission(context, 'monitor', 'create')).toBe(false);
      });

      it('should NOT have API key access', () => {
        expect(hasPermission(context, 'apiKey', 'view')).toBe(false);
        expect(hasPermission(context, 'apiKey', 'create')).toBe(false);
      });

      it('should NOT have variable secret access', () => {
        expect(hasPermission(context, 'variable', 'view_secrets')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should return false for invalid role', () => {
        const context: PermissionContext = {
          userId: 'user-1',
          role: 'invalid_role' as Role,
        };
        expect(hasPermission(context, 'test', 'view')).toBe(false);
      });

      it('should handle missing projectId in context', () => {
        const context: PermissionContext = {
          userId: 'user-1',
          role: Role.PROJECT_EDITOR,
          assignedProjectIds: ['project-1'],
          // No projectId - should still work for non-project-specific checks
        };
        expect(hasPermission(context, 'organization', 'view')).toBe(true);
      });
    });
  });

  describe('hasOrganizationWideAccess', () => {
    it('should return true for SUPER_ADMIN', () => {
      expect(hasOrganizationWideAccess(Role.SUPER_ADMIN)).toBe(true);
    });

    it('should return true for ORG_OWNER', () => {
      expect(hasOrganizationWideAccess(Role.ORG_OWNER)).toBe(true);
    });

    it('should return true for ORG_ADMIN', () => {
      expect(hasOrganizationWideAccess(Role.ORG_ADMIN)).toBe(true);
    });

    it('should return true for PROJECT_VIEWER', () => {
      expect(hasOrganizationWideAccess(Role.PROJECT_VIEWER)).toBe(true);
    });

    it('should return false for PROJECT_ADMIN', () => {
      expect(hasOrganizationWideAccess(Role.PROJECT_ADMIN)).toBe(false);
    });

    it('should return false for PROJECT_EDITOR', () => {
      expect(hasOrganizationWideAccess(Role.PROJECT_EDITOR)).toBe(false);
    });
  });

  describe('isProjectLimitedRole', () => {
    it('should return true for PROJECT_ADMIN', () => {
      expect(isProjectLimitedRole(Role.PROJECT_ADMIN)).toBe(true);
    });

    it('should return true for PROJECT_EDITOR', () => {
      expect(isProjectLimitedRole(Role.PROJECT_EDITOR)).toBe(true);
    });

    it('should return false for org-level roles', () => {
      expect(isProjectLimitedRole(Role.SUPER_ADMIN)).toBe(false);
      expect(isProjectLimitedRole(Role.ORG_OWNER)).toBe(false);
      expect(isProjectLimitedRole(Role.ORG_ADMIN)).toBe(false);
      expect(isProjectLimitedRole(Role.PROJECT_VIEWER)).toBe(false);
    });
  });

  describe('canEditResources', () => {
    it('should return true for all roles except PROJECT_VIEWER', () => {
      expect(canEditResources(Role.SUPER_ADMIN)).toBe(true);
      expect(canEditResources(Role.ORG_OWNER)).toBe(true);
      expect(canEditResources(Role.ORG_ADMIN)).toBe(true);
      expect(canEditResources(Role.PROJECT_ADMIN)).toBe(true);
      expect(canEditResources(Role.PROJECT_EDITOR)).toBe(true);
    });

    it('should return false for PROJECT_VIEWER', () => {
      expect(canEditResources(Role.PROJECT_VIEWER)).toBe(false);
    });
  });

  describe('canDeleteResources', () => {
    it('should return true for admin roles', () => {
      expect(canDeleteResources(Role.SUPER_ADMIN)).toBe(true);
      expect(canDeleteResources(Role.ORG_OWNER)).toBe(true);
      expect(canDeleteResources(Role.ORG_ADMIN)).toBe(true);
      expect(canDeleteResources(Role.PROJECT_ADMIN)).toBe(true);
    });

    it('should return false for PROJECT_EDITOR', () => {
      expect(canDeleteResources(Role.PROJECT_EDITOR)).toBe(false);
    });

    it('should return false for PROJECT_VIEWER', () => {
      expect(canDeleteResources(Role.PROJECT_VIEWER)).toBe(false);
    });
  });

  describe('checkRolePermissions', () => {
    it('should return true when role has all required permissions', () => {
      const result = checkRolePermissions(Role.ORG_OWNER, {
        test: ['create', 'view'],
        job: ['create', 'view'],
      });
      expect(result).toBe(true);
    });

    it('should return false when role is missing permissions', () => {
      const result = checkRolePermissions(Role.PROJECT_VIEWER, {
        test: ['create'],
      });
      expect(result).toBe(false);
    });

    it('should return false for invalid role', () => {
      const result = checkRolePermissions('invalid' as string, {
        test: ['view'],
      });
      expect(result).toBe(false);
    });

    it('should handle empty permissions object', () => {
      const result = checkRolePermissions(Role.PROJECT_VIEWER, {});
      expect(result).toBe(true);
    });
  });

  describe('Permission Matrix Validation', () => {
    // Comprehensive permission matrix tests based on spec
    const permissionMatrix: Array<{
      role: Role;
      resource: keyof typeof statement;
      action: string;
      expected: boolean;
    }> = [
      // SUPER_ADMIN - full access
      { role: Role.SUPER_ADMIN, resource: 'system', action: 'manage_users', expected: true },
      { role: Role.SUPER_ADMIN, resource: 'organization', action: 'delete', expected: true },
      { role: Role.SUPER_ADMIN, resource: 'variable', action: 'view_secrets', expected: true },

      // ORG_OWNER - no system, full org/project
      { role: Role.ORG_OWNER, resource: 'system', action: 'manage_users', expected: false },
      { role: Role.ORG_OWNER, resource: 'organization', action: 'delete', expected: true },
      { role: Role.ORG_OWNER, resource: 'test', action: 'delete', expected: true },

      // ORG_ADMIN - no org delete
      { role: Role.ORG_ADMIN, resource: 'organization', action: 'delete', expected: false },
      { role: Role.ORG_ADMIN, resource: 'organization', action: 'update', expected: true },
      { role: Role.ORG_ADMIN, resource: 'member', action: 'create', expected: true },

      // PROJECT_VIEWER - view only
      { role: Role.PROJECT_VIEWER, resource: 'test', action: 'view', expected: true },
      { role: Role.PROJECT_VIEWER, resource: 'test', action: 'create', expected: false },
      { role: Role.PROJECT_VIEWER, resource: 'apiKey', action: 'view', expected: false },
    ];

    permissionMatrix.forEach(({ role, resource, action, expected }) => {
      it(`${role} should ${expected ? '' : 'NOT '}have ${resource}:${action}`, () => {
        const context: PermissionContext = {
          userId: 'test-user',
          role,
          assignedProjectIds: ['project-1'],
          projectId: 'project-1',
        };
        expect(hasPermission(context, resource, action)).toBe(expected);
      });
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle undefined assignedProjectIds for PROJECT_ADMIN', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: 'project-1',
        // assignedProjectIds is undefined
      };
      // Should fall back to view-only
      expect(hasPermission(context, 'test', 'view')).toBe(true);
    });

    it('should handle empty assignedProjectIds array', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_EDITOR,
        projectId: 'project-1',
        assignedProjectIds: [],
      };
      // Empty array means no project assignments
      expect(hasPermission(context, 'test', 'create')).toBe(false);
    });

    it('should handle permission check with invalid resource for non-super-admin', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.ORG_OWNER,
      };
      // Invalid resource should return false (SUPER_ADMIN bypasses this check)
      expect(hasPermission(context, 'invalid_resource' as keyof typeof statement, 'view')).toBe(false);
    });

    it('should handle permission check with invalid action', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.ORG_OWNER,
      };
      // Invalid action should return false
      expect(hasPermission(context, 'test', 'invalid_action')).toBe(false);
    });

    it('should handle very long projectId', () => {
      const longProjectId = 'p'.repeat(1000);
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: longProjectId,
        assignedProjectIds: [longProjectId],
      };
      expect(hasPermission(context, 'test', 'create')).toBe(true);
    });

    it('should handle special characters in projectId', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: 'project-with-special-chars-@#$%',
        assignedProjectIds: ['project-with-special-chars-@#$%'],
      };
      expect(hasPermission(context, 'test', 'create')).toBe(true);
    });

    it('should handle multiple assigned projects correctly', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_EDITOR,
        projectId: 'project-3',
        assignedProjectIds: ['project-1', 'project-2', 'project-3', 'project-4'],
      };
      expect(hasPermission(context, 'test', 'create')).toBe(true);
    });

    it('should handle case sensitivity in projectId matching', () => {
      const context: PermissionContext = {
        userId: 'user-1',
        role: Role.PROJECT_ADMIN,
        projectId: 'Project-1', // Different case
        assignedProjectIds: ['project-1'], // lowercase
      };
      // Should NOT match due to case sensitivity
      expect(hasPermission(context, 'test', 'create')).toBe(false);
    });
  });
});
