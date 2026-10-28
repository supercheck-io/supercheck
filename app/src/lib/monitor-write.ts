import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitorNotificationSettings, notificationProviders, tests } from "@/db/schema";
import type { AlertConfig, MonitorConfig } from "@/db/schema";
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

/** One alertConfig shape for every monitor write path (create, both PUTs, PATCH). */
export function normalizeMonitorAlertConfig(raw: Raw): NormalizedAlertConfig {
  const thresholdError = alertThresholdError(raw);
  if (thresholdError) return { ok: false, error: thresholdError };
  const flag = (key: string, fallback: boolean) => (raw[key] !== undefined ? Boolean(raw[key]) : fallback);
  const optionalBool = (key: string) => (typeof raw[key] === "boolean" ? (raw[key] as boolean) : undefined);
  const providers = Array.isArray(raw.notificationProviders) ? raw.notificationProviders : [];
  if (providers.some((id) => typeof id !== "string" || id.trim().length === 0)) {
    return { ok: false, error: "Notification provider IDs must be non-empty strings" };
  }
  return {
    ok: true,
    value: {
      enabled: Boolean(raw.enabled),
      notificationProviders: providers as string[],
      alertOnFailure: flag("alertOnFailure", true),
      alertOnRecovery: flag("alertOnRecovery", true),
      alertOnSslExpiration: flag("alertOnSslExpiration", false),
      failureThreshold: (raw.failureThreshold as number | undefined | null) ?? 1,
      recoveryThreshold: (raw.recoveryThreshold as number | undefined | null) ?? 1,
      customMessage: typeof raw.customMessage === "string" ? raw.customMessage : "",
      incidentEnabled: optionalBool("incidentEnabled"),
      incidentSeverity: ["sev1", "sev2", "sev3", "sev4"].includes(raw.incidentSeverity as string)
        ? (raw.incidentSeverity as AlertConfig["incidentSeverity"])
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
