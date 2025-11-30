/**
 * Session Management Tests
 * 
 * Comprehensive test coverage for session management with RBAC
 * 
 * Test Categories:
 * - User Session (getCurrentUser)
 * - Organization (getUserOrganizations)
 * - Projects (getUserProjects, getUserProjectRole)
 * - Role Conversion (convertRoleToUnified)
 * - Error Handling (auth failures, database errors)
 */

// Mock setup - define the functions that will be used by mocks
const mockAuthModule = {
  getSession: jest.fn(),
};

const mockDbModule = {
  select: jest.fn(),
  update: jest.fn(),
};

jest.mock('@/utils/auth', () => ({
  auth: {
    api: {
      getSession: (...args: any[]) => mockAuthModule.getSession(...args),
    },
  },
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/utils/db', () => ({
  db: {
    select: (...args: any[]) => mockDbModule.select(...args),
    update: (...args: any[]) => mockDbModule.update(...args),
  },
}));

jest.mock('drizzle-orm', () => ({
  eq: jest.fn(),
  and: jest.fn(),
}));

jest.mock('@/db/schema', () => ({
  organization: { id: 'org_id', name: 'org_name' },
  projects: { id: 'proj_id', name: 'proj_name' },
  member: { userId: 'member_user_id', organizationId: 'member_org_id' },
  session: { token: 'session_token', userId: 'session_user_id' },
  user: { id: 'user_id' },
  projectMembers: { userId: 'pm_user_id', projectId: 'pm_project_id' },
}));

const mockRbacModule = {
  getUserRole: jest.fn(),
  getUserOrgRole: jest.fn(),
};

jest.mock('./rbac/middleware', () => ({
  getUserRole: (...args: any[]) => mockRbacModule.getUserRole(...args),
  getUserOrgRole: (...args: any[]) => mockRbacModule.getUserOrgRole(...args),
}));

jest.mock('./rbac/permissions', () => ({
  Role: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    ORG_OWNER: 'ORG_OWNER',
    ORG_ADMIN: 'ORG_ADMIN',
    PROJECT_ADMIN: 'PROJECT_ADMIN',
    PROJECT_EDITOR: 'PROJECT_EDITOR',
    PROJECT_VIEWER: 'PROJECT_VIEWER',
  },
}));

// Import after mocks
import { Role } from './rbac/permissions';
import {
  getCurrentUser,
  getUserOrganizations,
  getUserProjects,
  getUserProjectRole,
} from './session';

describe('Session Management', () => {
  const testUserId = 'user-123';
  const testOrgId = 'org-456';
  const testProjectId = 'project-789';

  const mockSession = {
    user: {
      id: testUserId,
      name: 'Test User',
      email: 'test@example.com',
      image: 'https://example.com/avatar.jpg',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      token: 'session-token-123',
    },
  };

  const mockDbSession = {
    token: 'session-token-123',
    userId: testUserId,
    impersonatedBy: null,
    activeProjectId: testProjectId,
  };

  const mockOrganization = {
    id: testOrgId,
    name: 'Test Organization',
    slug: 'test-org',
    logo: 'https://example.com/logo.png',
    createdAt: new Date(),
    memberRole: 'org_admin',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockAuthModule.getSession.mockResolvedValue(mockSession);
    mockRbacModule.getUserRole.mockResolvedValue(Role.ORG_ADMIN);
    mockRbacModule.getUserOrgRole.mockResolvedValue(Role.ORG_ADMIN);
    
    // Default mock for db.select chain
    const selectChain = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([mockDbSession]),
    };
    mockDbModule.select.mockReturnValue(selectChain);
  });

  // ==========================================================================
  // GET CURRENT USER TESTS
  // ==========================================================================

  describe('getCurrentUser', () => {
    describe('Positive Cases', () => {
      it('should return user session with role', async () => {
        mockRbacModule.getUserRole.mockResolvedValue(Role.ORG_ADMIN);
        
        const result = await getCurrentUser();
        
        expect(result).toEqual({
          id: testUserId,
          name: 'Test User',
          email: 'test@example.com',
          image: 'https://example.com/avatar.jpg',
          role: Role.ORG_ADMIN,
        });
      });

      it('should handle missing image', async () => {
        mockAuthModule.getSession.mockResolvedValue({
          ...mockSession,
          user: { ...mockSession.user, image: null },
        });
        
        const result = await getCurrentUser();
        
        expect(result?.image).toBeUndefined();
      });

      it('should return role from getUserRole', async () => {
        mockRbacModule.getUserRole.mockResolvedValue(Role.SUPER_ADMIN);
        
        const result = await getCurrentUser();
        
        expect(result?.role).toBe(Role.SUPER_ADMIN);
      });
    });

    describe('Negative Cases', () => {
      it('should return null when no session', async () => {
        mockAuthModule.getSession.mockResolvedValue(null);
        
        const result = await getCurrentUser();
        
        expect(result).toBeNull();
      });

      it('should return null on auth error', async () => {
        mockAuthModule.getSession.mockRejectedValue(new Error('Auth error'));
        
        const result = await getCurrentUser();
        
        expect(result).toBeNull();
      });
    });

    describe('Impersonation Cases', () => {
      it('should return impersonated user when impersonation active', async () => {
        const impersonatedUserId = 'impersonated-user-456';
        const impersonatedUser = {
          id: impersonatedUserId,
          name: 'Impersonated User',
          email: 'impersonated@example.com',
          image: null,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        // First call: session lookup (with impersonation)
        // Second call: user lookup for impersonated user
        let callCount = 0;
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([{ 
                ...mockDbSession, 
                impersonatedBy: testUserId,
                userId: impersonatedUserId,
              }]);
            }
            return Promise.resolve([impersonatedUser]);
          }),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        mockRbacModule.getUserRole.mockResolvedValue(Role.PROJECT_VIEWER);
        
        const result = await getCurrentUser();
        
        expect(result?.id).toBe(impersonatedUserId);
        expect(result?.name).toBe('Impersonated User');
      });
    });
  });

  // ==========================================================================
  // GET USER ORGANIZATIONS TESTS
  // ==========================================================================

  describe('getUserOrganizations', () => {
    describe('Positive Cases', () => {
      it('should return organizations with roles', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([
            { ...mockOrganization, memberRole: 'org_owner' },
            { ...mockOrganization, id: 'org-2', memberRole: 'org_admin' },
          ]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result).toHaveLength(2);
        expect(result[0].role).toBe(Role.ORG_OWNER);
        expect(result[1].role).toBe(Role.ORG_ADMIN);
      });

      it('should convert all role types correctly', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([
            { ...mockOrganization, memberRole: 'super_admin' },
            { ...mockOrganization, id: 'org-2', memberRole: 'project_admin' },
            { ...mockOrganization, id: 'org-3', memberRole: 'project_editor' },
            { ...mockOrganization, id: 'org-4', memberRole: 'project_viewer' },
          ]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result[0].role).toBe(Role.SUPER_ADMIN);
        expect(result[1].role).toBe(Role.PROJECT_ADMIN);
        expect(result[2].role).toBe(Role.PROJECT_EDITOR);
        expect(result[3].role).toBe(Role.PROJECT_VIEWER);
      });

      it('should default to PROJECT_VIEWER for unknown roles', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([
            { ...mockOrganization, memberRole: 'unknown_role' },
          ]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result[0].role).toBe(Role.PROJECT_VIEWER);
      });

      it('should handle null role', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([
            { ...mockOrganization, memberRole: null },
          ]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result[0].role).toBe(Role.PROJECT_VIEWER);
      });
    });

    describe('Negative Cases', () => {
      it('should return empty array on error', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockRejectedValue(new Error('DB error')),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result).toEqual([]);
      });

      it('should return empty array when no organizations', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // GET USER PROJECTS TESTS
  // ==========================================================================

  describe('getUserProjects', () => {
    describe('Positive Cases', () => {
      it('should return projects for org admin', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(Role.ORG_ADMIN);
        
        const mockProject = {
          id: testProjectId,
          name: 'Test Project',
          slug: 'test-project',
          description: 'Test description',
          organizationId: testOrgId,
          isDefault: true,
          status: 'active',
          createdAt: new Date(),
        };
        
        // First call: get projects, second call: get project members
        let callCount = 0;
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve([mockProject]);
            }
            return Promise.resolve([]);
          }),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserProjects(testUserId, testOrgId);
        
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(testProjectId);
        expect(result[0].role).toBe(Role.ORG_ADMIN);
      });
    });

    describe('Negative Cases', () => {
      it('should return empty array when user has no org role', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(null);
        
        const result = await getUserProjects(testUserId, testOrgId);
        
        expect(result).toEqual([]);
      });

      it('should return empty array on error', async () => {
        mockRbacModule.getUserOrgRole.mockRejectedValue(new Error('Error'));
        
        const result = await getUserProjects(testUserId, testOrgId);
        
        expect(result).toEqual([]);
      });
    });
  });

  // ==========================================================================
  // GET USER PROJECT ROLE TESTS
  // ==========================================================================

  describe('getUserProjectRole', () => {
    describe('Positive Cases', () => {
      it('should return org role for ORG_OWNER', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(Role.ORG_OWNER);
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.ORG_OWNER);
      });

      it('should return org role for ORG_ADMIN', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(Role.ORG_ADMIN);
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.ORG_ADMIN);
      });

      it('should check project assignment for PROJECT_ADMIN', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(Role.PROJECT_ADMIN);
        
        // Mock project assignment found
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([{ projectId: testProjectId }]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.PROJECT_ADMIN);
      });

      it('should return PROJECT_VIEWER when PROJECT_ADMIN not assigned to project', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(Role.PROJECT_ADMIN);
        
        // Mock no project assignment
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.PROJECT_VIEWER);
      });
    });

    describe('Negative Cases', () => {
      it('should return PROJECT_VIEWER when user has no org role', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(null);
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.PROJECT_VIEWER);
      });

      it('should return PROJECT_VIEWER on error', async () => {
        mockRbacModule.getUserOrgRole.mockRejectedValue(new Error('Error'));
        
        const result = await getUserProjectRole(testUserId, testOrgId, testProjectId);
        
        expect(result).toBe(Role.PROJECT_VIEWER);
      });
    });
  });

  // ==========================================================================
  // SECURITY TESTS
  // ==========================================================================

  describe('Security', () => {
    describe('Role Enforcement', () => {
      it('should always call getUserRole for role determination', async () => {
        await getCurrentUser();
        
        expect(mockRbacModule.getUserRole).toHaveBeenCalledWith(testUserId);
      });

      it('should check org role for project access', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(null);
        
        const result = await getUserProjects(testUserId, testOrgId);
        
        expect(result).toEqual([]);
        expect(mockRbacModule.getUserOrgRole).toHaveBeenCalledWith(testUserId, testOrgId);
      });
    });
  });

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    describe('Empty Inputs', () => {
      it('should handle empty user ID', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations('');
        
        expect(result).toEqual([]);
      });

      it('should handle empty organization ID', async () => {
        mockRbacModule.getUserOrgRole.mockResolvedValue(null);
        
        const result = await getUserProjects(testUserId, '');
        
        expect(result).toEqual([]);
      });
    });

    describe('Null Values', () => {
      it('should handle null slug', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([{
            ...mockOrganization,
            slug: null,
            memberRole: 'org_admin',
          }]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result[0].slug).toBeUndefined();
      });

      it('should handle null logo', async () => {
        const selectChain = {
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue([{
            ...mockOrganization,
            logo: null,
            memberRole: 'org_admin',
          }]),
        };
        mockDbModule.select.mockReturnValue(selectChain);
        
        const result = await getUserOrganizations(testUserId);
        
        expect(result[0].logo).toBeUndefined();
      });
    });

    describe('Concurrent Access', () => {
      it('should handle concurrent getCurrentUser calls', async () => {
        const promises = Array.from({ length: 5 }, () => getCurrentUser());
        
        const results = await Promise.all(promises);
        
        results.forEach(result => {
          expect(result?.id).toBe(testUserId);
        });
      });
    });
  });
});
