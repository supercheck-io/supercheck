import { liveMonitor } from "@/lib/deletion/visibility";
import { db } from "@/utils/db";
import { monitors, statusPageComponentMonitors } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { staleComponentIds } from "./stale-components";

/** Components whose linked monitors all stopped reporting; shared by the public page and badge. */
export async function loadStaleComponentIds(componentIds: string[]): Promise<Set<string>> {
  if (!componentIds.length) return new Set();
  // Freshness is a hint: a failed lookup keeps the stored statuses rather than failing the page.
  try {
    return staleComponentIds(await loadLinks(componentIds));
  } catch (error) {
    console.error("[status-page] component freshness lookup failed:", error);
    return new Set();
  }
}

function loadLinks(componentIds: string[]) {
  return db
    .select({
      componentId: statusPageComponentMonitors.componentId,
      enabled: monitors.enabled,
      status: monitors.status,
      frequencyMinutes: monitors.frequencyMinutes,
      lastCheckAt: monitors.lastCheckAt,
      createdAt: monitors.createdAt,
    })
    .from(statusPageComponentMonitors)
    .innerJoin(monitors, eq(monitors.id, statusPageComponentMonitors.monitorId))
    .where(and(inArray(statusPageComponentMonitors.componentId, componentIds), liveMonitor()));
}
