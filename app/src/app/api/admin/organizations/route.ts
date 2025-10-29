import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { member, projects } from "@/db/schema";
import { getAllOrganizations, requireAdmin } from "@/lib/admin";
import { eq, count } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const includeStats = searchParams.get("stats") === "true";

    const organizations = await getAllOrganizations(limit, offset);

    if (includeStats) {
      // Get member and project counts for each organization
      const orgsWithStats = await Promise.all(
        organizations.map(async (org) => {
          const [memberCountResult] = await db
            .select({ count: count() })
            .from(member)
            .where(eq(member.organizationId, org.id));

          const [projectCountResult] = await db
            .select({ count: count() })
            .from(projects)
            .where(eq(projects.organizationId, org.id));

          return {
            ...org,
            memberCount: memberCountResult.count,
            projectCount: projectCountResult.count,
          };
        })
      );

      return NextResponse.json({
        success: true,
        data: orgsWithStats,
        pagination: {
          limit,
          offset,
          hasMore: organizations.length === limit,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: organizations,
      pagination: {
        limit,
        offset,
        hasMore: organizations.length === limit,
      },
    });
  } catch (error) {
    console.error("Admin organizations GET error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch organizations" },
      {
        status:
          error instanceof Error &&
          error.message === "Admin privileges required"
            ? 403
            : 500,
      }
    );
  }
}
