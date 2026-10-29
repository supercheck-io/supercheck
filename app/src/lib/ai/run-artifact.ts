import { desc, eq, sql } from "drizzle-orm";
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
  // Two lookups: the primary key first, then the newest run carrying this test id (the same order as
  // resolveAccessContext), so neither query has to sort an OR of both conditions.
  const columns = { id: true, jobId: true } as const;
  const run =
    (await db.query.runs.findFirst({ where: eq(runs.id, id), columns })) ??
    (await db.query.runs.findFirst({
      where: sql`${runs.metadata}->>'testId' = ${id}`,
      orderBy: [desc(runs.createdAt)],
      columns,
    }));
  return { artifactId: run?.id ?? id, jobId: run?.jobId ?? null };
}
