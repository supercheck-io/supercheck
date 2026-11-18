import { and, eq, sql } from "drizzle-orm";
import { sreEvidenceItems } from "@/db/schema";
import { db } from "@/utils/db";
import { persistNativeEvidence } from "@/lib/sre/evidence-brief-orchestrator";

/**
 * persistNativeEvidence bounded by a timeout, for agent runs that must not wait on it. Rows already
 * written still commit after a timeout, so callers recount stored evidence instead of trusting a count.
 */
export async function persistNativeEvidenceWithin(
  input: Omit<Parameters<typeof persistNativeEvidence>[0], "signal">,
  timeoutMs: number,
): Promise<void> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      persistNativeEvidence({ ...input, signal: abort.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new Error("native evidence collection timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Evidence items stored for an incident, by source. */
export async function countStoredIncidentEvidence(input: {
  organizationId: string;
  projectId: string;
  incidentId: string;
}): Promise<{ total: number; connector: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      connector: sql<number>`count(*) filter (where ${sreEvidenceItems.sourceType} != 'native')::int`,
    })
    .from(sreEvidenceItems)
    .where(
      and(
        eq(sreEvidenceItems.organizationId, input.organizationId),
        eq(sreEvidenceItems.projectId, input.projectId),
        eq(sreEvidenceItems.incidentId, input.incidentId),
      ),
    );
  return { total: Number(row?.total ?? 0), connector: Number(row?.connector ?? 0) };
}
