import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { z } from "zod";
import { assertExecutionQueueReady, getRedisConnection } from "@/lib/queue";
import { stripUrl } from "./draft-schema";

/** Must match SETUP_SCAN_QUEUE in worker/src/setup/setup-scan.processor.ts. */
export const SETUP_SCAN_QUEUE = "setup-scan";

/** A scan nobody picked up after this long means no worker consumes the queue (spec: unavailable). */
export const SCAN_PICKUP_TIMEOUT_MS = 90_000;

const MAX_PAGES = 20;

export const scanIdPrefix = (projectId: string) => `${SETUP_SCAN_QUEUE}:${projectId}:`;

/** Allowlist of what a scan may store: codes, timings, titles and paths. Never bodies or headers. */
const pathOf = z.string().max(300).startsWith("/");
const scanResultSchema = z.object({
  finalUrl: z.string().max(2048).transform((v) => stripUrl(v) ?? ""),
  reachable: z.boolean(),
  status: z.number().int().nullable(),
  redirects: z.number().int().min(0).max(10),
  responseMs: z.number().min(0).nullable(),
  ssl: z
    .object({ validTo: z.string().max(40), daysRemaining: z.number().int(), issuer: z.string().max(120) })
    .nullable(),
  pages: z
    .array(
      z.object({
        path: pathOf,
        status: z.number().int().min(0).max(599),
        ms: z.number().min(0),
        title: z.string().max(120).nullable(),
      }),
    )
    .max(MAX_PAGES),
  blockedReason: z.string().max(60).optional(),
  error: z.enum(["unreachable", "blocked_private", "bot_protection", "timeout", "too_many_redirects"]).optional(),
});
export type ScanSummary = z.infer<typeof scanResultSchema>;

/** Strips unknown keys (version skew, or anything a worker should never have returned) and re-validates. */
export function sanitizeScanResult(raw: unknown): ScanSummary | null {
  const parsed = scanResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
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
  | { status: "done"; result: ScanSummary };

/** Reads one scan job; null when it does not exist (expired after an hour, or never created). */
export async function readScan(scanId: string): Promise<ScanStatus | null> {
  await assertExecutionQueueReady();
  const job = await (await getScanQueue()).getJob(scanId);
  if (!job) return null;
  switch (await job.getState()) {
    case "completed": {
      const result = sanitizeScanResult(job.returnvalue);
      return result ? { status: "done", result } : { status: "failed" };
    }
    case "failed":
      return { status: "failed" };
    case "active":
      return { status: "running" };
    default:
      return { status: Date.now() - job.timestamp > SCAN_PICKUP_TIMEOUT_MS ? "unavailable" : "queued" };
  }
}
