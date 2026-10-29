import { desc, eq, or, sql } from "drizzle-orm";
import { runs } from "@/db/schema";
import { db } from "@/utils/db";

/**
 * Workers store run-backed reports under the run id, while the playground and
 * saved tests send their test id. Resolve the newest run for that id; fall back
 * to the id itself for reports stored before runs owned their directories.
 */
export async function resolveRunArtifact(
  id: string
): Promise<{ artifactId: string; jobId: string | null }> {
  const run = await db.query.runs.findFirst({
    where: or(eq(runs.id, id), sql`${runs.metadata}->>'testId' = ${id}`),
    orderBy: [desc(sql`${runs.id} = ${id}`), desc(runs.createdAt)],
    columns: { id: true, jobId: true },
  });
  return { artifactId: run?.id ?? id, jobId: run?.jobId ?? null };
}
