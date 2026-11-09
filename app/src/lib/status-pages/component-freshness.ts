import { db } from "@/utils/db";
import { monitors, statusPageComponentMonitors } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { staleComponentIds } from "./stale-components";

/** Components whose linked monitors all stopped reporting; shared by the public page and badge. */
export async function loadStaleComponentIds(componentIds: string[]): Promise<Set<string>> {
  if (!componentIds.length) return new Set();
  return staleComponentIds(await db
    .select({
      componentId: statusPageComponentMonitors.componentId,
      enabled: monitors.enabled,
      status: monitors.status,
      frequencyMinutes: monitors.frequencyMinutes,
      lastCheckAt: monitors.lastCheckAt,
    })
    .from(statusPageComponentMonitors)
    .innerJoin(monitors, eq(monitors.id, statusPageComponentMonitors.monitorId))
    .where(inArray(statusPageComponentMonitors.componentId, componentIds)));
}
