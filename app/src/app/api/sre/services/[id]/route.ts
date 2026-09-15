import { and, desc, eq, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sreServiceDependencies, sreServiceHealthSnapshots, sreServices } from "@/db/schema";
import { db } from "@/utils/db";
import { requireSreApiPermissions } from "../../_auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSreApiPermissions([{ resource: "sre_service", action: "view" }]);
  if (!auth.success) return auth.response;
  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) return NextResponse.json({ error: "Invalid service ID" }, { status: 400 });

  const [service] = await db.select({
    id: sreServices.id, name: sreServices.name, description: sreServices.description,
    tier: sreServices.tier, environment: sreServices.environment, ownerTeam: sreServices.ownerTeam,
    repoUrl: sreServices.repoUrl, otelServiceName: sreServices.otelServiceName,
    slackChannel: sreServices.slackChannel, tags: sreServices.tags, status: sreServices.status,
    createdAt: sreServices.createdAt, updatedAt: sreServices.updatedAt,
  }).from(sreServices).where(and(
    eq(sreServices.id, parsedId.data),
    eq(sreServices.organizationId, auth.context.organizationId),
    eq(sreServices.projectId, auth.context.project.id),
  )).limit(1);
  if (!service) return NextResponse.json({ error: "Service not found" }, { status: 404 });

  const [health, dependencies] = await Promise.all([
    db.query.sreServiceHealthSnapshots.findFirst({
      where: and(eq(sreServiceHealthSnapshots.serviceId, service.id), eq(sreServiceHealthSnapshots.projectId, auth.context.project.id)),
      orderBy: [desc(sreServiceHealthSnapshots.windowEnd)],
    }),
    db.select().from(sreServiceDependencies).where(and(
      eq(sreServiceDependencies.organizationId, auth.context.organizationId),
      eq(sreServiceDependencies.projectId, auth.context.project.id),
      or(eq(sreServiceDependencies.sourceServiceId, service.id), eq(sreServiceDependencies.targetServiceId, service.id)),
    )).orderBy(desc(sreServiceDependencies.lastSeenAt)).limit(200),
  ]);

  return NextResponse.json({ success: true, service, health: health ?? null, dependencies });
}
