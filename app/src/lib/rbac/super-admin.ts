/**
 * Secure Super Admin Management
 *
 * This module provides secure super admin management using Better Auth's
 * built-in capabilities instead of relying on environment variables.
 */

import { db } from "@/utils/db";
import { user } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/utils/auth";
import { Role } from "./permissions";
import { normalizeRole } from "./role-normalizer";

/**
 * Check if a user is a super admin using database role
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    // Query the user's role directly from the database
    const userRecord = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (userRecord.length === 0) {
      return false;
    }

    return userRecord[0].role === "super_admin";
  } catch (error) {
    console.error("Error checking super admin status:", error);
    return false;
  }
}

/**
 * Get all super admin users
 */
export async function getSuperAdmins(): Promise<
  Array<{ id: string; email: string; name: string }>
> {
  try {
    // Query users with super admin role in the database
    const superAdmins = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(eq(user.role, "super_admin"));

    return superAdmins;
  } catch (error) {
    console.error("Error fetching super admins:", error);
    return [];
  }
}

/**
 * Grant super admin role to a user (requires existing super admin)
 */
export async function grantSuperAdmin(
  targetUserId: string,
  grantedByUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify the grantor is a super admin
    const isGrantorSuperAdmin = await isSuperAdmin(grantedByUserId);
    if (!isGrantorSuperAdmin) {
      return {
        success: false,
        error: "Only super admins can grant super admin privileges",
      };
    }

    // Update the target user's role
    await db
      .update(user)
      .set({ role: "super_admin" })
      .where(eq(user.id, targetUserId));

    // Invalidate all sessions for the target user to force re-authentication
    await invalidateUserSessions(targetUserId, "role_elevated_to_super_admin");

    // Log the action
    await logAdminAction({
      userId: grantedByUserId,
      action: "grant_super_admin",
      targetUserId,
      metadata: {
        targetUserId,
        timestamp: new Date().toISOString(),
        sessionInvalidated: true,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error granting super admin:", error);
    return { success: false, error: "Internal server error" };
  }
}

/**
 * Revoke super admin role from a user (requires existing super admin)
 */
export async function revokeSuperAdmin(
  targetUserId: string,
  revokedByUserId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify the revoker is a super admin
    const isRevokerSuperAdmin = await isSuperAdmin(revokedByUserId);
    if (!isRevokerSuperAdmin) {
      return {
        success: false,
        error: "Only super admins can revoke super admin privileges",
      };
    }

    // Prevent self-revocation
    if (targetUserId === revokedByUserId) {
      return {
        success: false,
        error: "Cannot revoke your own super admin privileges",
      };
    }

    // Check if this is the last super admin
    const superAdmins = await getSuperAdmins();
    if (superAdmins.length <= 1) {
      return { success: false, error: "Cannot revoke the last super admin" };
    }

    // Update the target user's role to project_viewer (default)
    await db
      .update(user)
      .set({ role: "project_viewer" })
      .where(eq(user.id, targetUserId));

    // Invalidate all sessions for the target user to remove elevated privileges immediately
    await invalidateUserSessions(targetUserId, "role_revoked_from_super_admin");

    // Log the action
    await logAdminAction({
      userId: revokedByUserId,
      action: "revoke_super_admin",
      targetUserId,
      metadata: {
        targetUserId,
        timestamp: new Date().toISOString(),
        sessionInvalidated: true,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error revoking super admin:", error);
    return { success: false, error: "Internal server error" };
  }
}

/**
 * Bootstrap first super admin (ONLY for initial system setup)
 * This should be called ONCE during initial deployment to create the first admin
 *
 * Security: This function should be removed or protected after initial setup
 */
export async function bootstrapFirstSuperAdmin(
  email: string,
  performedBy: string = "system"
): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // Check if any super admins already exist
    const existingSuperAdmins = await getSuperAdmins();
    if (existingSuperAdmins.length > 0) {
      return {
        success: false,
        message: "Super admins already exist. Use grantSuperAdmin() instead.",
      };
    }

    // Find the user by email
    const existingUser = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.email, email.trim().toLowerCase()))
      .limit(1);

    if (existingUser.length === 0) {
      return {
        success: false,
        message: `User with email ${email} not found. User must sign up first.`,
      };
    }

    // Grant super admin role
    await db
      .update(user)
      .set({ role: "super_admin" })
      .where(eq(user.id, existingUser[0].id));

    // Log the bootstrap action (with script context)
    try {
      const { logAuditEvent } = await import("@/lib/audit-logger");
      await logAuditEvent({
        userId: "system",
        action: "bootstrap_super_admin",
        resource: "user",
        resourceId: existingUser[0].id,
        metadata: {
          email,
          performedBy,
          targetUserId: existingUser[0].id,
          timestamp: new Date().toISOString(),
          note: "First super admin bootstrapped",
        },
        success: true,
        ipAddress: "bootstrap-script",
        userAgent: "system",
      });
    } catch {
      // Don't fail bootstrap if audit logging fails
      console.log("⚠️  Audit logging skipped (script context)");
    }

    return {
      success: true,
      message: `Successfully bootstrapped ${email} as first super admin`,
    };
  } catch (error) {
    console.error("Error bootstrapping super admin:", error);
    return { success: false, message: "Failed to bootstrap super admin" };
  }
}

/**
 * Invalidate all sessions for a user (force re-authentication)
 */
async function invalidateUserSessions(
  userId: string,
  reason: string
): Promise<void> {
  try {
    // Use Better Auth's session revocation API
    await auth.api.revokeUserSessions({
      body: {
        userId,
      },
    });

    // Log session invalidation
    const { logAuditEvent } = await import("@/lib/audit-logger");
    await logAuditEvent({
      userId,
      action: "sessions_invalidated",
      resource: "session",
      metadata: {
        reason,
        timestamp: new Date().toISOString(),
        allSessionsRevoked: true,
      },
      success: true,
    });
  } catch (error) {
    console.error("Failed to invalidate user sessions:", error);
    // Don't throw - session invalidation failure shouldn't break role changes
  }
}

/**
 * Log admin actions for audit trail
 */
async function logAdminAction(data: {
  userId: string;
  action: string;
  targetUserId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    // Import audit logger dynamically to avoid circular dependencies
    const { logAuditEvent } = await import("@/lib/audit-logger");

    await logAuditEvent({
      userId: data.userId,
      action: data.action,
      resource: "user",
      resourceId: data.targetUserId,
      metadata: data.metadata,
      success: true,
    });
  } catch (error) {
    console.error("Failed to log admin action:", error);
  }
}

/**
 * Middleware to require super admin privileges
 */
export async function requireSuperAdmin(): Promise<{
  userId: string;
  error?: string;
}> {
  try {
    const session = await auth.api.getSession({
      headers: new Headers(),
    });

    if (!session) {
      return { userId: "", error: "Authentication required" };
    }

    const isSuperAdminUser = await isSuperAdmin(session.user.id);
    if (!isSuperAdminUser) {
      return { userId: "", error: "Super admin privileges required" };
    }

    return { userId: session.user.id };
  } catch (error) {
    console.error("Error in requireSuperAdmin:", error);
    return { userId: "", error: "Authentication failed" };
  }
}

/**
 * Get user's highest role across all contexts
 */
export async function getUserHighestRole(userId: string): Promise<Role> {
  try {
    // First check if user is super admin
    const isSA = await isSuperAdmin(userId);
    if (isSA) {
      return Role.SUPER_ADMIN;
    }

    // Check user's role in the database
    const userRecord = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (userRecord.length > 0 && userRecord[0].role) {
      return normalizeRole(userRecord[0].role);
    }

    // Default to project viewer
    return Role.PROJECT_VIEWER;
  } catch (error) {
    console.error("Error getting user highest role:", error);
    return Role.PROJECT_VIEWER;
  }
}

