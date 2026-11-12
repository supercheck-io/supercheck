/**
 * Gated, lazy entry points for app code (queues, schedulers). Imports no
 * @sentry/* code: ./sentry is loaded only after the gate passes, so a disabled or
 * self-hosted deployment never loads the SDK. Every helper is best effort and
 * never throws into the caller.
 */
import { getSentryDsn } from "@/lib/sentry-gate";
import type { CronSchedule } from "@/lib/sentry";

type SentryModule = typeof import("@/lib/sentry");

async function load(): Promise<SentryModule | null> {
  if (!getSentryDsn()) return null;
  try {
    const mod = await import("@/lib/sentry");
    return mod.initSentry() ? mod : null;
  } catch {
    return null;
  }
}

/** Trace headers for a queued job, so the worker continues the request's trace. Empty when off. */
export async function getTraceHeaders(): Promise<{ sentryTrace?: string; baggage?: string }> {
  try {
    return (await load())?.getTraceHeaders() ?? {};
  } catch {
    return {};
  }
}

const lastCheckIn = new Map<string, number>();

/**
 * Runs one scheduler tick and sends a cron check-in when `ran(result)` says this
 * replica did the work (it held the lock or lease), so replicas that skip never
 * report. A throw sends an error check-in and is rethrown. `minIntervalMs`
 * throttles check-ins for ticks that run more often than once a minute.
 */
export async function checkedTick<T>(
  slug: string,
  schedule: CronSchedule,
  fn: () => Promise<T>,
  ran: (result: T) => boolean = () => true,
  minIntervalMs = 0,
): Promise<T> {
  const started = Date.now();
  const report = (status: "ok" | "error") => {
    if (status === "ok" && started - (lastCheckIn.get(slug) ?? 0) < minIntervalMs) return;
    lastCheckIn.set(slug, started);
    void load()
      .then((sdk) => sdk?.captureCheckIn(slug, schedule, status, (Date.now() - started) / 1000))
      .catch(() => undefined);
  };
  try {
    const result = await fn();
    if (ran(result)) report("ok");
    return result;
  } catch (error) {
    report("error");
    throw error;
  }
}
