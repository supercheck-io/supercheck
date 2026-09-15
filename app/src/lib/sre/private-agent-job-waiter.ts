export type PrivateAgentConnectorJob = {
  status:
    | "queued"
    | "leased"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out";
  resultHash: string | null;
  resultSummary: Record<string, unknown> | null;
  errorCode: string | null;
};

export type PrivateAgentConnectorJobWaitResult =
  | { state: "completed"; job: PrivateAgentConnectorJob }
  | { state: "failed"; job: PrivateAgentConnectorJob }
  | { state: "pending"; job: PrivateAgentConnectorJob }
  | { state: "missing" };

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLL_INTERVAL_MS = 1_000;

function defaultSleep(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForPrivateAgentConnectorJob(input: {
  load: () => Promise<PrivateAgentConnectorJob | null>;
  timeoutMs: number;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<PrivateAgentConnectorJobWaitResult> {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  let pollIntervalMs = Math.max(
    1,
    input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const maxPollIntervalMs = Math.max(
    pollIntervalMs,
    input.maxPollIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS,
  );
  const deadline = now() + Math.max(0, input.timeoutMs);

  while (true) {
    const job = await input.load();
    if (!job) return { state: "missing" };
    if (job.status === "completed") return { state: "completed", job };
    if (
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "timed_out"
    ) {
      return { state: "failed", job };
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) return { state: "pending", job };
    await sleep(Math.min(pollIntervalMs, remainingMs));
    pollIntervalMs = Math.min(pollIntervalMs * 2, maxPollIntervalMs);
  }
}
