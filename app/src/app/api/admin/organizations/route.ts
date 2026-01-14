import { NextRequest, NextResponse } from "next/server";
import { db } from "@/utils/db";
import { member, projects, organization, user } from "@/db/schema";
import { requireAdmin } from "@/lib/admin";
import { eq, count, desc, and, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const includeStats = searchParams.get("stats") === "true";

    // Base query for organizations
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
      .orderBy(desc(organization.id))
      .limit(limit)
      .offset(offset);

    if (organizations.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        pagination: { limit, offset, hasMore: false },
      });
    }

    const orgIds = organizations.map((org) => org.id);

    // PERFORMANCE: Batch fetch all related data with SQL aggregation
    // This replaces N+1 queries (2 queries per org) with 3 total queries
    const [memberCounts, projectCounts, ownerEmails] = await Promise.all([
      // Get member counts for all orgs in one query
      db
        .select({
          organizationId: member.organizationId,
          count: count(),
        })
        .from(member)
        .where(sql`${member.organizationId} IN ${orgIds}`)
        .groupBy(member.organizationId),

      // Get project counts for all orgs in one query
      db
        .select({
          organizationId: projects.organizationId,
          count: count(),
        })
        .from(projects)
        .where(sql`${projects.organizationId} IN ${orgIds}`)
        .groupBy(projects.organizationId),

      // Get owner emails for all orgs in one query
      db
        .select({
          organizationId: member.organizationId,
          ownerEmail: user.email,
          ownerName: user.name,
        })
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            sql`${member.organizationId} IN ${orgIds}`,
            eq(member.role, "org_owner")
          )
        ),
    ]);

    // Build lookup maps for O(1) access
    const memberCountMap = new Map(
      memberCounts.map((m) => [m.organizationId, m.count])
    );
    const projectCountMap = new Map(
      projectCounts.map((p) => [p.organizationId, p.count])
    );
    const ownerMap = new Map(
      ownerEmails.map((o) => [o.organizationId, o.ownerEmail])
    );

    // Enrich organizations with counts and owner
    const enrichedOrgs = organizations.map((org) => ({
      ...org,
      ownerEmail: ownerMap.get(org.id) ?? null,
      ...(includeStats && {
        memberCount: memberCountMap.get(org.id) ?? 0,
        projectCount: projectCountMap.get(org.id) ?? 0,
      }),
    }));

    return NextResponse.json({
      success: true,
      data: enrichedOrgs,
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
