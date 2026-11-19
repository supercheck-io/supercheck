import { and, count, eq, inArray } from "drizzle-orm";

import { jobNotificationSettings, jobs, monitorNotificationSettings, monitors, notificationPolicies } from "@/db/schema";
import { liveJob, liveMonitor } from "@/lib/deletion/visibility";
import { db } from "@/utils/db";

export type ChannelUsage = { monitors: number; jobs: number; policy: boolean };

/** What sends to each channel: live monitors and jobs, and whether the project's incident policy uses it (directly or for escalation). */
export async function loadChannelUsage(projectId: string, providerIds: string[]): Promise<Map<string, ChannelUsage>> {
  const usage = new Map(providerIds.map((id) => [id, { monitors: 0, jobs: 0, policy: false }]));
  if (providerIds.length === 0) return usage;
  const monitorCounts = await db
    .select({ id: monitorNotificationSettings.notificationProviderId, n: count() })
    .from(monitorNotificationSettings)
    .innerJoin(monitors, eq(monitors.id, monitorNotificationSettings.monitorId))
    .where(and(inArray(monitorNotificationSettings.notificationProviderId, providerIds), eq(monitors.projectId, projectId), liveMonitor()))
    .groupBy(monitorNotificationSettings.notificationProviderId);
  const jobCounts = await db
    .select({ id: jobNotificationSettings.notificationProviderId, n: count() })
    .from(jobNotificationSettings)
    .innerJoin(jobs, eq(jobs.id, jobNotificationSettings.jobId))
    .where(and(inArray(jobNotificationSettings.notificationProviderId, providerIds), eq(jobs.projectId, projectId), liveJob()))
    .groupBy(jobNotificationSettings.notificationProviderId);
  const [policy] = await db
    .select({ channelIds: notificationPolicies.channelIds, escalateChannelId: notificationPolicies.escalateChannelId })
    .from(notificationPolicies)
    .where(eq(notificationPolicies.projectId, projectId));
  for (const row of monitorCounts) { const u = usage.get(row.id); if (u) u.monitors = Number(row.n); }
  for (const row of jobCounts) { const u = usage.get(row.id); if (u) u.jobs = Number(row.n); }
  for (const id of [...(policy?.channelIds ?? []), policy?.escalateChannelId]) { const u = id ? usage.get(id) : undefined; if (u) u.policy = true; }
  return usage;
}
