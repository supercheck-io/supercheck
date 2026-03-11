import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/utils/db";
import { locations } from "@/db/schema/locations";
import { eq, ne, sql } from "drizzle-orm";
import { invalidateLocationCache } from "@/lib/location-registry";
import { updateLocationSchema } from "@/lib/validations/location";
import { getRedisConnection, invalidateQueueMaps, queueLogger } from "@/lib/queue";
import { invalidateQueueEventHub } from "@/lib/queue-event-hub";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/locations/[id] — Update a location (Super Admin)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;

    const body = await request.json();
    const parsed = updateLocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    // Check location exists
    const [existing] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    // Use a transaction to prevent TOCTOU races on default enforcement and disable guard
    const updated = await db.transaction(async (tx) => {
      // Enforce single default: clear others before setting new default
      if (parsed.data.isDefault) {
        await tx
          .update(locations)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(ne(locations.id, id));
      }

      // Block disabling the last enabled location
      if (parsed.data.isEnabled === false && existing.isEnabled) {
        const enabledCount = await tx
          .select({ count: sql<number>`count(*)` })
          .from(locations)
          .where(eq(locations.isEnabled, true));
        if ((enabledCount[0]?.count ?? 0) <= 1) {
          throw new Error("CONFLICT:Cannot disable the last enabled location. At least one enabled location must exist.");
        }
      }

      const [result] = await tx
        .update(locations)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(eq(locations.id, id))
        .returning();

      return result;
    });

    invalidateLocationCache();

    // Rebuild queue maps when location enabled/disabled state may have changed
    try {
      await invalidateQueueMaps();
    } catch (err) {
      queueLogger.warn({ err }, "Queue map invalidation after location update failed (non-fatal)");
    }

    // Refresh SSE event hub so it reflects the updated location state
    try {
      await invalidateQueueEventHub();
    } catch (err) {
      queueLogger.warn({ err }, "Queue event hub refresh after location update failed (non-fatal)");
    }

    try {
      const { invalidateBullBoard } = await import(
        "@/app/api/admin/queues/[[...path]]/route"
      );
      invalidateBullBoard();
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (error != null && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Another location is already set as default. Please try again." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { success: false, error: message.slice("CONFLICT:".length) },
        { status: 409 }
      );
    }
    const status = message.includes("privileges required") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * DELETE /api/admin/locations/[id] — Delete a location (Super Admin)
 */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;

    // Check location exists
    const [existing] = await db
      .select()
      .from(locations)
      .where(eq(locations.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Location not found" },
        { status: 404 }
      );
    }

    // The "local" location is the ultimate fallback for self-hosted setups
    // and the getFirstDefaultLocationCode() safety net. Deleting it creates
    // an unrecoverable state because createLocationSchema reserves "local"
    // and prevents re-creation through the API.
    if (existing.code === "local") {
      return NextResponse.json(
        {
          success: false,
          error: 'The "local" location cannot be deleted. It is the system fallback location. You can disable it instead.',
        },
        { status: 403 }
      );
    }

    // Check for active, waiting, delayed, or prioritized jobs in this location's queues
    const redis = await getRedisConnection();
    const queuePrefixes = [`k6-${existing.code}`, `monitor-${existing.code}`];
    for (const prefix of queuePrefixes) {
      // BullMQ v5+ key types: `:wait` (list), `:active` (list), `:delayed` (sorted set), `:prioritized` (sorted set)
      const waitKey = `bull:${prefix}:wait`;
      const activeKey = `bull:${prefix}:active`;
      const delayedKey = `bull:${prefix}:delayed`;
      const prioritizedKey = `bull:${prefix}:prioritized`;
      const [waitingCount, activeCount, delayedCount, prioritizedCount] = await Promise.all([
        redis.llen(waitKey).catch(() => 0),
        redis.llen(activeKey).catch(() => 0),
        redis.zcard(delayedKey).catch(() => 0),
        redis.zcard(prioritizedKey).catch(() => 0),
      ]);
      const totalJobs = waitingCount + activeCount + delayedCount + prioritizedCount;
      if (totalJobs > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Cannot delete location "${existing.code}": ${totalJobs} active/waiting/delayed/prioritized jobs in queue. Drain the queue first.`,
          },
          { status: 409 }
        );
      }
    }

    // Use a transaction for atomic count check + delete to prevent TOCTOU race
    await db.transaction(async (tx) => {
      const enabledCount = await tx
        .select({ count: sql<number>`count(*)` })
        .from(locations)
        .where(eq(locations.isEnabled, true));
      if ((enabledCount[0]?.count ?? 0) <= 1 && existing.isEnabled) {
        throw new Error("CONFLICT:Cannot delete the last enabled location. At least one enabled location must exist.");
      }

      // Delete (project_locations cascade handled by ON DELETE CASCADE)
      await tx.delete(locations).where(eq(locations.id, id));
    });

    invalidateLocationCache();

    // Rebuild queue maps so deleted location's queues are removed
    try {
      await invalidateQueueMaps();
    } catch (err) {
      queueLogger.warn({ err }, "Queue map invalidation after location delete failed (non-fatal)");
    }

    // Refresh SSE event hub so it stops listening to the deleted location's queues
    try {
      await invalidateQueueEventHub();
    } catch (err) {
      queueLogger.warn({ err }, "Queue event hub refresh after location delete failed (non-fatal)");
    }

    try {
      const { invalidateBullBoard } = await import(
        "@/app/api/admin/queues/[[...path]]/route"
      );
      invalidateBullBoard();
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    if (message.startsWith("CONFLICT:")) {
      return NextResponse.json(
        { success: false, error: message.slice("CONFLICT:".length) },
        { status: 409 }
      );
    }
    const status = message.includes("privileges required") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
