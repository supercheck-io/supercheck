import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitorNotificationSettings, notificationProviders, tests } from "@/db/schema";
import type { AlertConfig, MonitorConfig } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { alertThresholdError } from "@/lib/alert-thresholds";

/** Config keys the worker writes. A client replacing `config` must not wipe or forge them. */
export const WORKER_OWNED_CONFIG_KEYS = ["aggregatedAlertState", "sslLastCheckedAt"] as const;

export function preserveWorkerConfigKeys<T extends MonitorConfig | null | undefined>(
  existing: MonitorConfig | null | undefined,
  next: T,
): T {
  if (!next) return next;
  const merged: Record<string, unknown> = { ...next };
  for (const key of WORKER_OWNED_CONFIG_KEYS) {
    const stored = (existing as Record<string, unknown> | null | undefined)?.[key];
    if (stored === undefined) delete merged[key];
    else merged[key] = stored;
  }
  return merged as T;
}

type Raw = Record<string, unknown>;
export type NormalizedAlertConfig = Result<AlertConfig>;
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * One alertConfig shape for every monitor write path (create, both PUTs, PATCH). An omitted field takes the
 * stored value on update (`existing`), and the create default otherwise, so a round trip never flips a flag.
 */
export function normalizeMonitorAlertConfig(raw: Raw, existing?: Partial<AlertConfig> | null): NormalizedAlertConfig {
  const thresholdError = alertThresholdError(raw);
  if (thresholdError) return { ok: false, error: thresholdError };
  const prior = (existing ?? {}) as Record<string, unknown>;
  const flag = (key: string, fallback: boolean) =>
    raw[key] !== undefined ? Boolean(raw[key]) : typeof prior[key] === "boolean" ? (prior[key] as boolean) : fallback;
  const optionalBool = (key: string) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : typeof prior[key] === "boolean" ? (prior[key] as boolean) : undefined;
  const providers = Array.isArray(raw.notificationProviders)
    ? raw.notificationProviders
    : Array.isArray(prior.notificationProviders) ? prior.notificationProviders : [];
  const num = (key: string) => (raw[key] as number | undefined | null) ?? (prior[key] as number | undefined) ?? 1;
  if (providers.some((id) => typeof id !== "string" || !isUuid(id))) {
    return { ok: false, error: "Notification provider IDs must be valid UUIDs" };
  }
  return {
    ok: true,
    value: {
      enabled: flag("enabled", false),
      notificationProviders: providers as string[],
      alertOnFailure: flag("alertOnFailure", true),
      alertOnRecovery: flag("alertOnRecovery", true),
      alertOnSslExpiration: flag("alertOnSslExpiration", false),
      failureThreshold: num("failureThreshold"),
      recoveryThreshold: num("recoveryThreshold"),
      customMessage: typeof raw.customMessage === "string" ? raw.customMessage : typeof prior.customMessage === "string" ? prior.customMessage : "",
      incidentEnabled: optionalBool("incidentEnabled"),
      incidentSeverity: ["sev1", "sev2", "sev3", "sev4"].includes(raw.incidentSeverity as string)
        ? (raw.incidentSeverity as AlertConfig["incidentSeverity"])
        : ["sev1", "sev2", "sev3", "sev4"].includes(prior.incidentSeverity as string)
          ? (prior.incidentSeverity as AlertConfig["incidentSeverity"])
          : undefined,
      autoResolveIncident: optionalBool("autoResolveIncident"),
    },
  };
}

/** Rules for an enabled alertConfig: a channel, within the cap, and at least one alert type. */
export function enabledAlertConfigError(config: AlertConfig): string | null {
  if (!config.enabled) return null;
  if (config.notificationProviders.length === 0) {
    return "At least one notification channel must be selected when alerts are enabled";
  }
  const max = parseInt(process.env.MAX_MONITOR_NOTIFICATION_CHANNELS || "10", 10);
  if (config.notificationProviders.length > max) return `You can only select up to ${max} notification channels`;
  if (!config.alertOnFailure && !config.alertOnRecovery && !config.alertOnSslExpiration) {
    return "At least one alert type must be selected when alerts are enabled";
  }
  return null;
}

/** Provider ids that are not in this organization and project. */
export async function providerIdsOutsideProject(ids: string[], organizationId: string, projectId: string) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: notificationProviders.id })
    .from(notificationProviders)
    .where(
      and(
        inArray(notificationProviders.id, ids),
        eq(notificationProviders.organizationId, organizationId),
        eq(notificationProviders.projectId, projectId),
      ),
    );
  const valid = new Set(rows.map((row) => row.id));
  return ids.filter((id) => !valid.has(id));
}

/** Replace the rows the worker delivers through. Returns false, writing nothing, when an id is not in the project. */
export async function replaceMonitorProviders(
  monitorId: string,
  ids: string[],
  organizationId: string,
  projectId: string,
): Promise<boolean> {
  const unique = Array.from(new Set(ids));
  return db.transaction(async (tx) => {
    if (unique.length > 0) {
      const rows = await tx
        .select({ id: notificationProviders.id })
        .from(notificationProviders)
        .where(
          and(
            inArray(notificationProviders.id, unique),
            eq(notificationProviders.organizationId, organizationId),
            eq(notificationProviders.projectId, projectId),
          ),
        );
      if (rows.length !== unique.length) return false;
    }
    await tx.delete(monitorNotificationSettings).where(eq(monitorNotificationSettings.monitorId, monitorId));
    if (unique.length > 0) {
      await tx
        .insert(monitorNotificationSettings)
        .values(unique.map((notificationProviderId) => ({ monitorId, notificationProviderId })))
        .onConflictDoNothing();
    }
    return true;
  });
}

/** True when the test belongs to this project and organization. */
export async function testInProject(testId: unknown, organizationId: string, projectId: string): Promise<boolean> {
  if (typeof testId !== "string") return false;
  const test = await db.query.tests.findFirst({
    where: and(eq(tests.id, testId), eq(tests.projectId, projectId), eq(tests.organizationId, organizationId)),
    columns: { id: true },
  });
  return Boolean(test);
}

/** Synthetic checks run a full browser test, so plans and the form advertise a 5-minute floor. */
export const SYNTHETIC_MIN_FREQUENCY_MINUTES = 5;

/** Checks the stored-or-new type against the stored-or-new frequency, so changing either one is covered. */
export function syntheticFrequencyError(type: unknown, frequencyMinutes: unknown): string | null {
  if (type !== "synthetic_test" || frequencyMinutes === undefined || frequencyMinutes === null) return null;
  const minutes = Number(frequencyMinutes);
  return !Number.isFinite(minutes) || minutes < SYNTHETIC_MIN_FREQUENCY_MINUTES
    ? `Synthetic monitors can run no more often than every ${SYNTHETIC_MIN_FREQUENCY_MINUTES} minutes`
    : null;
}
