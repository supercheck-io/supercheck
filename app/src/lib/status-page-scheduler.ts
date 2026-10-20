import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { checkStatusPageDomain } from "./status-page-domain-check";
import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./queue";
import { reconcileStatusPages } from "./status-page-reconciliation";
import {
  enqueuePendingDeliveries,
  processDelivery,
} from "./incident-notifications/delivery-worker";

let worker: Worker | undefined;
let queue: Queue | undefined;

export async function initializeStatusPageScheduler() {
  if (worker) return;
  const redis = await getRedisConnection();
  queue = new Queue("status-page-jobs", { connection: redis });
  worker = new Worker(
    "status-page-jobs",
    async (job) => {
      if (job.name === "tick") {
        await reconcileStatusPages();
        await enqueuePendingDeliveries(queue!);
        const due = await db
          .select({
            id: statusPages.id,
            domain: statusPages.customDomain,
          })
          .from(statusPages)
          .where(
            and(
              eq(statusPages.customDomainVerified, true),
              or(
                isNull(statusPages.customDomainLastCheckedAt),
                lte(
                  statusPages.customDomainLastCheckedAt,
                  new Date(Date.now() - 86400000),
                ),
              ),
            ),
          )
          .limit(5);
        for (const page of due) {
          if (!page.domain) continue;
          // Observability only: a DNS miss never unverifies or detaches a
          // published custom domain. The operator fixes the records.
          const result = await checkStatusPageDomain(page.domain, page.id);
          if (result !== "valid") console.warn("Status page custom domain DNS check failed", { statusPageId: page.id, result });
          await db
            .update(statusPages)
            .set({ customDomainLastCheckedAt: new Date() })
            .where(
              and(
                eq(statusPages.id, page.id),
                eq(statusPages.customDomain, page.domain),
              ),
            );
        }
      } else if (job.name === "deliver") {
        await processDelivery(job.data.deliveryId);
      }
    },
    { connection: redis.duplicate(), concurrency: 5, lockDuration: 120000 },
  );
  worker.on("error", (error) =>
    console.error("Status page worker error", error),
  );
  worker.on("failed", (job, error) =>
    console.error("Status page job failed", job?.id, error.message),
  );
  await queue.upsertJobScheduler(
    "status-page-reconciliation",
    { every: 10000 },
    {
      name: "tick",
      data: {},
      opts: { removeOnComplete: true, removeOnFail: 100 },
    },
  );
}
