import { and, eq, inArray } from "drizzle-orm";
import { apikey, jobs } from "@/db/schema";
import type { db } from "@/utils/db";

type Executor = Pick<typeof db, "update" | "select">;

/** Disable a user's job trigger keys for one organization when they lose membership. */
export async function disableTriggerKeysForMember(tx: Executor, userId: string, organizationId: string) {
  await tx
    .update(apikey)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(
      eq(apikey.referenceId, userId),
      inArray(apikey.jobId, tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.organizationId, organizationId))),
    ));
}
