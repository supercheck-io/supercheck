import { desc, eq } from "drizzle-orm";

import { sreIncidentTimelineEvents } from "@/db/schema";
import { db } from "@/utils/db";

/** The newest 500 (so a long incident keeps its latest events), returned oldest first. Caller scopes the incident. */
export async function newestIncidentTimelineEvents(incidentId: string) {
  const newest = await db.select().from(sreIncidentTimelineEvents)
    .where(eq(sreIncidentTimelineEvents.incidentId, incidentId))
    .orderBy(desc(sreIncidentTimelineEvents.createdAt)).limit(500);
  return newest.reverse();
}
