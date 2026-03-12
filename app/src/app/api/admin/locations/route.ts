import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/utils/db";
import { locations } from "@/db/schema/locations";
import { eq } from "drizzle-orm";
import {
  invalidateLocationCache,
  getAllLocations as getAllLocationsFromRegistry,
} from "@/lib/location-registry";
import { invalidateQueueMaps, queueLogger } from "@/lib/queue";
import { invalidateQueueEventHub } from "@/lib/queue-event-hub";
import { getWorkerCountByLocation, getUnregisteredWorkerLocations } from "@/lib/worker-registry";
import { createLocationSchema } from "@/lib/validations/location";

export type LocationWithStatus = {
  id: string;
  code: string;
  name: string;
  region: string | null;
  flag: string | null;
  coordinates: { lat: number; lon: number } | null;
  isEnabled: boolean;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  workerCount: number;
  status: "active" | "offline" | "disabled";
};

/**
 * GET /api/admin/locations — List all locations with worker status (Super Admin)
 */
export async function GET() {
  try {
    await requireAdmin();

    const [allLocations, workerCounts] = await Promise.all([
      getAllLocationsFromRegistry(),
      getWorkerCountByLocation(),
    ]);

    const knownCodes = new Set(allLocations.map((l) => l.code));
    const unregistered = await getUnregisteredWorkerLocations(knownCodes);

    const locationsWithStatus: LocationWithStatus[] = allLocations.map((loc) => {
      const wCount = workerCounts[loc.code] || 0;
      return {
        ...loc,
        workerCount: wCount,
        status: !loc.isEnabled
          ? "disabled"
          : wCount > 0
            ? "active"
            : "offline",
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        locations: locationsWithStatus,
        unregisteredLocations: unregistered,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("privileges required") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

/**
 * POST /api/admin/locations — Create a new location (Super Admin)
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin();

    const body = await request.json();
    const parsed = createLocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const { code, name, region, flag, coordinates, isDefault, sortOrder } = parsed.data;

    // Check for duplicate code
    const [existing] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, code))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { success: false, error: `Location with code "${code}" already exists` },
        { status: 409 }
      );
    }

    // Use a transaction for atomic default enforcement + insert
    const created = await db.transaction(async (tx) => {
      // Enforce single default: clear others before setting new default
      if (isDefault) {
        await tx
          .update(locations)
          .set({ isDefault: false, updatedAt: new Date() });
      }

      const [result] = await tx
        .insert(locations)
        .values({
          code,
          name,
          region: region ?? null,
          flag: flag ?? null,
          coordinates: coordinates ?? null,
          isDefault: isDefault ?? false,
          sortOrder: sortOrder ?? 0,
        })
        .returning();

      return result;
    });

    invalidateLocationCache();

    // Rebuild queue maps so new location's queues become available immediately
    try {
      await invalidateQueueMaps();
    } catch (err) {
      queueLogger.warn({ err }, "Queue map invalidation after location create failed (non-fatal)");
    }

    // Refresh SSE event hub so it listens to the new location's queues
    try {
      await invalidateQueueEventHub();
    } catch (err) {
      queueLogger.warn({ err }, "Queue event hub refresh after location create failed (non-fatal)");
    }

    // Invalidate Bull Dashboard so new queues appear
    try {
      const { invalidateBullBoard } = await import(
        "@/lib/bull-board/state"
      );
      invalidateBullBoard();
    } catch {
      // Bull Dashboard invalidation is best-effort
    }

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error: unknown) {
    if (error != null && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505") {
      return NextResponse.json(
        { success: false, error: "Another location is already set as default. Please try again." },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("privileges required") ? 403 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
