import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { z } from "zod";
import { assertExecutionQueueReady, getRedisConnection } from "@/lib/queue";
import { stripUrl } from "./draft-schema";

/** Must match SETUP_SCAN_QUEUE in worker/src/setup/setup-scan.processor.ts. */
export const SETUP_SCAN_QUEUE = "setup-scan";

/** A scan still waiting after this long, with no worker consuming the queue, is unavailable (spec). */
export const SCAN_PICKUP_TIMEOUT_MS = 90_000;

const MAX_PAGES = 20;

export const scanIdPrefix = (projectId: string) => `${SETUP_SCAN_QUEUE}:${projectId}:`;

/** Allowlist of what a scan may store: codes, timings, titles and paths. Never bodies or headers. */
// Some sites answer with non-HTTP codes (LinkedIn sends 999): clamp instead of failing the scan.
const clampStatus = z.number().int().transform((n) => Math.min(999, Math.max(0, n)));
const pageSchema = z.object({
  path: z.string().max(300).startsWith("/"),
  status: clampStatus,
  ms: z.number().min(0),
  title: z.string().max(120).nullable(),
});
const scanResultSchema = z.object({
  finalUrl: z.string().max(2048).transform((v) => stripUrl(v) ?? ""),
  reachable: z.boolean(),
  status: clampStatus.nullable(),
  redirects: z.number().int().min(0).max(10),
  responseMs: z.number().min(0).nullable(),
  ssl: z
    .object({ validTo: z.string().max(40), daysRemaining: z.number().int(), issuer: z.string().max(120) })
    .nullable(),
  // Validated page by page below, so one bad page does not drop the rest.
  pages: z.array(z.unknown()).max(MAX_PAGES),
  blockedReason: z.string().max(60).optional(),
  error: z.enum(["unreachable", "blocked_private", "bot_protection", "timeout", "too_many_redirects", "ssl_invalid"]).optional(),
});
export type ScanSummary = Omit<z.infer<typeof scanResultSchema>, "pages"> & { pages: z.infer<typeof pageSchema>[] };

/** Strips unknown keys (version skew, or anything a worker should never have returned) and re-validates. */
export function sanitizeScanResult(raw: unknown): ScanSummary | null {
  const parsed = scanResultSchema.safeParse(raw);
  if (!parsed.success) return null;
  const pages = parsed.data.pages.flatMap((page) => {
    const one = pageSchema.safeParse(page);
    return one.success ? [one.data] : [];
  });
  return { ...parsed.data, pages };
}

let queue: Queue | null = null;
async function getScanQueue(): Promise<Queue> {
  if (queue) return queue;
  queue = new Queue(SETUP_SCAN_QUEUE, {
    connection: await getRedisConnection(),
    defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 3600 } },
  });
  queue.on("error", (error) => console.error("setup-scan queue error:", error));
  return queue;
}

/** Queues one scan. The worker applies its own internal-target policy; the payload only carries the URL. */
export async function enqueueScan(projectId: string, url: string): Promise<string> {
  await assertExecutionQueueReady();
  const scanId = `${scanIdPrefix(projectId)}${randomUUID()}`;
  await (await getScanQueue()).add("scan", { url }, { jobId: scanId });
  return scanId;
}

export type ScanStatus =
  | { status: "queued" | "running" | "failed" | "unavailable" }
  | { status: "done"; result: ScanSummary; scannedAt: number };

/** Reads one scan job; null when it does not exist (expired after an hour, or never created). */
export async function readScan(scanId: string): Promise<ScanStatus | null> {
  await assertExecutionQueueReady();
  const scanQueue = await getScanQueue();
  let job = await scanQueue.getJob(scanId);
  if (!job) return null;
  const state = await job.getState();
  switch (state) {
    case "completed": {
      // getState() does not refresh the job: a scan that finished after getJob still shows no return value.
      if (job.returnvalue == null) job = (await scanQueue.getJob(scanId)) ?? job;
      const result = sanitizeScanResult(job.returnvalue);
      return result ? { status: "done", result, scannedAt: job.finishedOn ?? job.timestamp } : { status: "failed" };
    }
    case "failed":
      return { status: "failed" };
    case "active":
      return { status: "running" };
    default: {
      // Waiting is only "unavailable" when nobody consumes the queue; a busy worker keeps it queued.
      const stale = state === "waiting" && Date.now() - job.timestamp > SCAN_PICKUP_TIMEOUT_MS;
      return { status: stale && (await scanQueue.getWorkersCount()) === 0 ? "unavailable" : "queued" };
    }
  }
}
