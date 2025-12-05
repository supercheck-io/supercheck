import { db } from "@/utils/db";
import {
  user,
  organization,
  projects,
  jobs,
  tests,
  monitors,
  runs,
  member,
} from "@/db/schema";
import { count, eq, desc, or, isNull, gte, and } from "drizzle-orm";
import { getCurrentUser, getActiveOrganization } from "./session";
import { getUserRole, getUserOrgRole } from "./rbac/middleware";
import { Role } from "./rbac/permissions";

export async function isAdmin(): Promise<boolean> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) return false;

    // Use unified RBAC system to check admin privileges - SUPER_ADMIN only
    const role = await getUserRole(currentUser.id);
    return role === Role.SUPER_ADMIN;
  } catch (error) {
    console.error("Error checking admin status:", error);
    return false;
  }
}

export async function isSuperAdmin(): Promise<boolean> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) return false;

    // Use unified RBAC system to check super admin privileges
    const role = await getUserRole(currentUser.id);
    return role === Role.SUPER_ADMIN;
  } catch (error) {
    console.error("Error checking super admin status:", error);
    return false;
  }
}

export async function isOrgAdmin(): Promise<boolean> {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) return false;

    // Check if user is admin or owner of current organization
    const activeOrg = await getActiveOrganization();
    if (!activeOrg) return false;

    const orgRole = await getUserOrgRole(currentUser.id, activeOrg.id);
    return orgRole === Role.ORG_ADMIN || orgRole === Role.ORG_OWNER;
  } catch (error) {
    console.error("Error checking org admin status:", error);
    return false;
  }
}

export async function requireAdmin() {
  const isUserAdmin = await isAdmin();
  if (!isUserAdmin) {
    throw new Error("Admin privileges required");
  }
}

export interface UserStats {
  totalUsers: number;
  newUsersThisMonth: number;
  activeUsers: number;
  bannedUsers: number;
}

export async function getUserStats(): Promise<UserStats> {
  await requireAdmin();

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [totalUsersResult] = await db.select({ count: count() }).from(user);

  const [newUsersResult] = await db
    .select({ count: count() })
    .from(user)
    .where(gte(user.createdAt, thirtyDaysAgo));

  const [activeUsersResult] = await db
    .select({ count: count() })
    .from(user)
    .where(or(eq(user.banned, false), isNull(user.banned)));

  const [bannedUsersResult] = await db
    .select({ count: count() })
    .from(user)
    .where(eq(user.banned, true));

  return {
    totalUsers: totalUsersResult.count,
    newUsersThisMonth: newUsersResult.count,
    activeUsers: activeUsersResult.count,
    bannedUsers: bannedUsersResult.count,
  };
}

export interface OrgStats {
  totalOrganizations: number;
  totalProjects: number;
  totalJobs: number;
  totalTests: number;
  totalMonitors: number;
  totalRuns: number;
}

export async function getOrgStats(): Promise<OrgStats> {
  await requireAdmin();

  const [totalOrgsResult] = await db
    .select({ count: count() })
    .from(organization);
  const [totalProjectsResult] = await db
    .select({ count: count() })
    .from(projects);
  const [totalJobsResult] = await db.select({ count: count() }).from(jobs);
  const [totalTestsResult] = await db.select({ count: count() }).from(tests);
  const [totalMonitorsResult] = await db
    .select({ count: count() })
    .from(monitors);
  const [totalRunsResult] = await db.select({ count: count() }).from(runs);

  return {
    totalOrganizations: totalOrgsResult.count,
    totalProjects: totalProjectsResult.count,
    totalJobs: totalJobsResult.count,
    totalTests: totalTestsResult.count,
    totalMonitors: totalMonitorsResult.count,
    totalRuns: totalRunsResult.count,
  };
}

export interface SystemStats {
  users: UserStats;
  organizations: OrgStats;
}

export async function getSystemStats(): Promise<SystemStats> {
  await requireAdmin();

  const [userStats, orgStats] = await Promise.all([
    getUserStats(),
    getOrgStats(),
  ]);

  return {
    users: userStats,
    organizations: orgStats,
  };
}

export async function getAllUsers(limit = 50, offset = 0) {
  await requireAdmin();

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      role: user.role, // Keep the database role as backup
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
    })
    .from(user)
    .orderBy(desc(user.id)) // UUIDv7 is time-ordered (PostgreSQL 18+)
    .limit(limit)
    .offset(offset);

  // Enrich with actual RBAC roles (highest role across all orgs), org count, and organizations
  const enrichedUsers = await Promise.all(
    users.map(async (u) => {
      try {
        const [highestRole, userOrganizations] = await Promise.all([
          getUserHighestRole(u.id),
          getUserOrganizations(u.id),
        ]);

        return {
          ...u,
          role: highestRole,
          organizations: userOrganizations,
        };
      } catch (error) {
        console.error(`Error getting role for user ${u.id}:`, error);
        // Fallback to database role or default
        return {
          ...u,
          role: u.role || "project_viewer",
          organizations: [],
        };
      }
    })
  );

  return enrichedUsers;
}

/**
 * Get the user's highest role across all organizations for super admin display
 */
async function getUserHighestRole(userId: string): Promise<string> {
  // Super admin access is now managed through the database
  // Check user role directly from the database

  // Get all organization memberships and find highest role
  const memberships = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.userId, userId));

  if (memberships.length === 0) {
    return "project_viewer"; // Default for users with no org membership
  }

  // Role hierarchy (highest to lowest) - NEW RBAC ONLY
  const roleHierarchy = [
    "super_admin",
    "org_owner",
    "org_admin",
    "project_admin",
    "project_editor",
    "project_viewer",
  ];

  // Find the highest role
  for (const hierarchyRole of roleHierarchy) {
    if (memberships.some((m) => m.role === hierarchyRole)) {
      return hierarchyRole;
    }
  }

  return "project_viewer";
}

/**
 * Get the number of organizations a user is a member of
 */
async function getUserOrgCount(userId: string): Promise<number> {
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));

  return memberships.length;
}

/**
 * Get all organizations a user belongs to with their roles
 */
async function getUserOrganizations(userId: string): Promise<
  {
    organizationId: string;
    organizationName: string;
    role: string;
  }[]
> {
  const userOrganizations = await db
    .select({
      organizationId: member.organizationId,
      organizationName: organization.name,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(member.id); // UUIDv7 is time-ordered

  return userOrganizations;
}

export async function getAllOrganizations(limit = 50, offset = 0) {
  await requireAdmin();

  const organizations = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      createdAt: organization.createdAt,
      metadata: organization.metadata,
    })
    .from(organization)
    .orderBy(desc(organization.id)) // UUIDv7 is time-ordered (PostgreSQL 18+)
    .limit(limit)
    .offset(offset);

  // Enrich with owner information
  const enrichedOrganizations = await Promise.all(
    organizations.map(async (org) => {
      try {
        // Find the organization owner
        const ownerResult = await db
          .select({
            ownerEmail: user.email,
            ownerName: user.name,
          })
          .from(member)
          .innerJoin(user, eq(member.userId, user.id))
          .where(
            and(eq(member.organizationId, org.id), eq(member.role, "org_owner"))
          )
          .limit(1);

        const ownerEmail =
          ownerResult.length > 0 ? ownerResult[0].ownerEmail : null;

        return {
          ...org,
          ownerEmail,
        };
      } catch (error) {
        console.error(`Error getting owner for organization ${org.id}:`, error);
        return {
          ...org,
          ownerEmail: null,
        };
      }
    })
  );

  return enrichedOrganizations;
}
