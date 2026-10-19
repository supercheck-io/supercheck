"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { Queue } from "bullmq";
import { db } from "@/utils/db";
import {
  statusPages,
  incidents,
  statusPageNotificationEvents as events,
  statusPageNotificationDeliveries as deliveries,
} from "@/db/schema";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { getRedisConnection } from "@/lib/queue";
import { logAuditEvent } from "@/lib/audit-logger";

async function authorize(pageId: string, action: "view" | "update") {
  z.string().uuid().parse(pageId);
  const context = await requireProjectContext();
  await requirePermissions(
    { status_page: [action] },
    { organizationId: context.organizationId, projectId: context.project.id },
  );
  const page = await db.query.statusPages.findFirst({
    where: and(
      eq(statusPages.id, pageId),
      eq(statusPages.organizationId, context.organizationId),
      eq(statusPages.projectId, context.project.id),
    ),
    columns: { id: true },
  });
  if (!page) throw new Error("Status page not found or access denied");
  return context;
}

export async function getStatusPageDeliveries(pageId: string) {
  try {
    await authorize(pageId, "view");
    const rows = await db
      .select({
        id: deliveries.id,
        mode: deliveries.mode,
        status: deliveries.status,
        attempts: deliveries.attempts,
        lastError: deliveries.lastError,
        updatedAt: deliveries.updatedAt,
        incidentName: incidents.name,
      })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .innerJoin(incidents, eq(incidents.id, events.incidentId))
      .where(eq(incidents.statusPageId, pageId))
      .orderBy(desc(deliveries.updatedAt))
      .limit(100);
    return { success: true as const, deliveries: rows };
  } catch {
    return {
      success: false as const,
      deliveries: [],
      message: "Unable to load notification deliveries.",
    };
  }
}

export async function retryStatusPageDelivery(
  pageId: string,
  deliveryId: string,
) {
  try {
    z.string().uuid().parse(deliveryId);
    const context = await authorize(pageId, "update");
    const [delivery] = await db
      .select({ id: deliveries.id, status: deliveries.status })
      .from(deliveries)
      .innerJoin(events, eq(events.id, deliveries.eventId))
      .innerJoin(incidents, eq(incidents.id, events.incidentId))
      .where(
        and(eq(deliveries.id, deliveryId), eq(incidents.statusPageId, pageId)),
      );
    if (!delivery || delivery.status !== "failed")
      return {
        success: false,
        message: "Only failed deliveries can be retried.",
      };
    const queue = new Queue("status-page-jobs", {
      connection: await getRedisConnection(),
    });
    try {
      const job = await queue.getJob(deliveryId);
      if (job && (await job.getState()) === "active")
        return { success: false, message: "This delivery is still running." };
      if (job) await job.remove();
      await db
        .update(deliveries)
        .set({
          status: "pending",
          attempts: 0,
          leasedUntil: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(deliveries.id, deliveryId), eq(deliveries.status, "failed")),
        );
    } finally {
      await queue.close();
    }
    await logAuditEvent({
      userId: context.userId,
      action: "status_page_delivery_retried",
      resource: "status_page",
      resourceId: pageId,
      success: true,
      metadata: {
        deliveryId,
        organizationId: context.organizationId,
        projectId: context.project.id,
      },
    });
    return { success: true, message: "Delivery queued for retry." };
  } catch {
    return { success: false, message: "Unable to retry this delivery." };
  }
}
