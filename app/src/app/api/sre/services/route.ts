import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";

import { sreServices } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../_auth";

export async function GET() {
  const auth = await requireSreApiPermissions([
    { resource: "sre_service", action: "view" },
  ]);

  if (!auth.success) {
    return auth.response;
  }

  const services = await db.select({
    id: sreServices.id,
    name: sreServices.name,
    description: sreServices.description,
    tier: sreServices.tier,
    environment: sreServices.environment,
    ownerTeam: sreServices.ownerTeam,
    repoUrl: sreServices.repoUrl,
    otelServiceName: sreServices.otelServiceName,
    slackChannel: sreServices.slackChannel,
    tags: sreServices.tags,
    status: sreServices.status,
    createdAt: sreServices.createdAt,
    updatedAt: sreServices.updatedAt,
  }).from(sreServices).where(and(
    eq(sreServices.organizationId, auth.context.organizationId),
    eq(sreServices.projectId, auth.context.project.id),
    ne(sreServices.status, "merged"),
  )).orderBy(desc(sreServices.updatedAt)).limit(500);

  return NextResponse.json({ success: true, services });
}
