/**
 * User Defaults Management
 * Handles automatic creation of organization and project defaults for users
 */

import { db } from "@/utils/db";
import {
  organization as orgTable,
  projects,
  member,
  projectMembers,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Check if user has organization and project setup
 */
export async function userHasDefaults(userId: string): Promise<boolean> {
  try {
    const [existingMember] = await db
      .select()
      .from(member)
      .where(eq(member.userId, userId))
      .limit(1);

    return !!existingMember;
  } catch (error) {
    console.error("Error checking user defaults:", error);
    return false;
  }
}

/**
 * Create default organization and project for user
 */
export async function createUserDefaults(
  userId: string,
  userName: string,
  userEmail: string
) {
  try {
    console.log(`Creating defaults for user ${userEmail} (${userId})`);

    // Create default organization
    const [newOrg] = await db
      .insert(orgTable)
      .values({
        name: `${userName}'s Organization`,
        slug: randomUUID(),
        createdAt: new Date(),
      })
      .returning();

    // Add user as owner of the organization
    await db.insert(member).values({
      organizationId: newOrg.id,
      userId: userId,
      role: "org_owner",
      createdAt: new Date(),
    });

    // Create default project
    const [newProject] = await db
      .insert(projects)
      .values({
        organizationId: newOrg.id,
        name: process.env.DEFAULT_PROJECT_NAME || "Default Project",
        slug: randomUUID(),
        description: "Your default project for getting started",
        isDefault: true,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Add user as owner of the project
    await db.insert(projectMembers).values({
      userId: userId,
      projectId: newProject.id,
      role: "org_owner",
      createdAt: new Date(),
    });

    console.log(
      `✅ Created default org "${newOrg.name}" and project "${newProject.name}" for user ${userEmail}`
    );

    return {
      organization: newOrg,
      project: newProject,
    };
  } catch (error) {
    console.error("❌ Failed to create user defaults:", error);
    throw error;
  }
}

/**
 * Ensure user has defaults, create if missing
 */
export async function ensureUserDefaults(
  userId: string,
  userName: string,
  userEmail: string
) {
  const hasDefaults = await userHasDefaults(userId);

  if (!hasDefaults) {
    console.log(`User ${userEmail} has no defaults, creating...`);
    await createUserDefaults(userId, userName, userEmail);
  }

  return hasDefaults;
}
