import { isPolarEnabled } from "@/lib/feature-flags";
import { polarUsageService } from "@/lib/services/polar-usage.service";

type UsageSyncSchedulerState = {
  timer: ReturnType<typeof setInterval>;
  running: boolean;
};

declare global {
  var __supercheckUsageSyncScheduler: UsageSyncSchedulerState | undefined;
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 50;

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function readPositiveIntegerEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unrefTimer(timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>) {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function initializeUsageSyncScheduler(): boolean {
  if (!isPolarEnabled()) {
    console.log("[UsageSyncScheduler] Polar is disabled, skipping usage sync scheduler");
    return false;
  }

  const enabled = readBooleanEnv(process.env.USAGE_SYNC_SCHEDULER_ENABLED, true);
  if (!enabled) {
    console.log("[UsageSyncScheduler] Disabled by USAGE_SYNC_SCHEDULER_ENABLED");
    return false;
  }

  if (globalThis.__supercheckUsageSyncScheduler) {
    return true;
  }

  const intervalMs = readPositiveIntegerEnv(
    process.env.USAGE_SYNC_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  );
  const batchSize = readPositiveIntegerEnv(
    process.env.USAGE_SYNC_BATCH_SIZE,
    DEFAULT_BATCH_SIZE
  );

  const runSync = async () => {
    const scheduler = globalThis.__supercheckUsageSyncScheduler;
    if (!scheduler || scheduler.running) {
      return;
    }

    scheduler.running = true;
    try {
      const result = await polarUsageService.syncPendingEvents(batchSize);
      if (result.processed > 0 || result.failed > 0) {
        console.log(
          `[UsageSyncScheduler] Synced usage events: ${result.succeeded}/${result.processed} succeeded, ${result.failed} failed`
        );
      }
    } catch (error) {
      console.error("[UsageSyncScheduler] Usage sync run failed:", error);
    } finally {
      scheduler.running = false;
    }
  };

  const timer = setInterval(runSync, intervalMs);
  unrefTimer(timer);

  globalThis.__supercheckUsageSyncScheduler = {
    timer,
    running: false,
  };

  const initialRun = setTimeout(runSync, 30_000);
  unrefTimer(initialRun);

  console.log(
    `[UsageSyncScheduler] Initialized usage sync every ${intervalMs}ms with batch size ${batchSize}`
  );

  return true;
}

export function stopUsageSyncScheduler(): void {
  const scheduler = globalThis.__supercheckUsageSyncScheduler;
  if (!scheduler) {
    return;
  }

  clearInterval(scheduler.timer);
  globalThis.__supercheckUsageSyncScheduler = undefined;
}
