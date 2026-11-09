import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/utils/db";
import { monitorNotificationSettings, monitors, notificationProviders, tests } from "@/db/schema";
import type { AlertConfig, MonitorConfig } from "@/db/schema";
import { isUuid } from "@/lib/uuid";
import { channelsOptional } from "@/lib/incident-settings";
import { alertThresholdError } from "@/lib/alert-thresholds";
import { sanitizeString } from "@/lib/input-sanitizer";
import catalog from "@/lib/billing/plan-catalog.json";

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
  const severity = raw.incidentSeverity;
  if (severity != null && severity !== "" && !["sev1", "sev2", "sev3", "sev4"].includes(severity as string)) {
    return { ok: false, error: "incidentSeverity must be one of sev1, sev2, sev3, sev4" };
  }
  if (providers.some((id) => typeof id !== "string" || !isUuid(id))) {
    return { ok: false, error: "Notification provider IDs must be valid UUIDs" };
  }
  // Canonical (lowercase, de-duplicated) so validation, storage and the delivery rows agree on one spelling.
  const canonicalProviders = Array.from(new Set((providers as string[]).map((id) => id.toLowerCase())));
  return {
    ok: true,
    value: {
      enabled: flag("enabled", false),
      notificationProviders: canonicalProviders,
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

/** Rules for an enabled alertConfig: a channel (unless incidents are on), within the cap, and at least one alert type. */
export function enabledAlertConfigError(config: AlertConfig): string | null {
  if (!config.enabled) return null;
  // Incidents need no channel, so an incident-only monitor may have none.
  if (config.notificationProviders.length === 0 && !channelsOptional(config)) {
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

export const INVALID_PROVIDERS_MESSAGE = "One or more notification providers are invalid or not accessible in this project";

/** Thrown inside a write transaction when a provider id is not in the project; the route answers 400. */
export class InvalidNotificationProvidersError extends Error {
  constructor() {
    super(INVALID_PROVIDERS_MESSAGE);
  }
}

type Tx = Pick<typeof db, "select" | "delete" | "insert">;

/** Replace the delivery rows inside the caller's transaction. Throws InvalidNotificationProvidersError, writing nothing. */
export async function syncMonitorProviderRows(
  tx: Tx,
  monitorId: string,
  ids: string[],
  organizationId: string,
  projectId: string,
  /** Ids the monitor already stored: if such a provider has since been deleted it is dropped, not an error. */
  storedIds: string[] = [],
): Promise<string[]> {
  let unique = Array.from(new Set(ids.map((id) => id.toLowerCase())));
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
    const found = new Set(rows.map((row) => row.id));
    const stored = new Set(storedIds.map((id) => id.toLowerCase()));
    if (unique.some((id) => !found.has(id) && !stored.has(id))) throw new InvalidNotificationProvidersError();
    unique = unique.filter((id) => found.has(id));
  }
  await tx.delete(monitorNotificationSettings).where(eq(monitorNotificationSettings.monitorId, monitorId));
  if (unique.length > 0) {
    await tx
      .insert(monitorNotificationSettings)
      .values(unique.map((notificationProviderId) => ({ monitorId, notificationProviderId })))
      .onConflictDoNothing();
  }
  return unique;
}

/** Thrown inside a link/unlink transaction when the resulting alertConfig would be invalid; the route answers 400. */
export class AlertConfigConflictError extends Error {}

/**
 * Take the monitor row lock as the first statement of a link/unlink transaction, the same order updateMonitorHandler and
 * PUT use (monitor row, then delivery rows): concurrent links would otherwise each mirror a partial list, and a link
 * racing a PUT/PATCH could deadlock.
 */
export async function lockMonitorRow(tx: Pick<typeof db, "select">, monitorId: string): Promise<void> {
  await tx.select({ id: monitors.id }).from(monitors).where(eq(monitors.id, monitorId)).for("update");
}

/**
 * After a single link is added or removed, bring alertConfig.notificationProviders (what the UI shows) in line with
 * the delivery rows (what the worker uses), in the caller's transaction. A monitor with no alertConfig gets the defaults.
 */
export async function mirrorProviderRowsToAlertConfig(tx: Pick<typeof db, "select" | "update">, monitorId: string): Promise<void> {
  const rows = await tx
    .select({ id: monitorNotificationSettings.notificationProviderId })
    .from(monitorNotificationSettings)
    .where(eq(monitorNotificationSettings.monitorId, monitorId));
  const [monitor] = await tx.select({ alertConfig: monitors.alertConfig }).from(monitors).where(eq(monitors.id, monitorId));
  if (!monitor) return;
  const normalized = normalizeMonitorAlertConfig({ notificationProviders: rows.map((row) => row.id) }, monitor.alertConfig);
  if (!normalized.ok) return;
  // Unlinking the last channel of an enabled alert that cannot open incidents would leave an alert that never delivers.
  const invalid = enabledAlertConfigError(normalized.value);
  if (invalid) throw new AlertConfigConflictError(invalid);
  await tx.update(monitors).set({ alertConfig: normalized.value }).where(eq(monitors.id, monitorId));
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

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * PATCH merge semantics (RFC 7396): objects merge recursively, arrays and scalars replace, and an
 * explicit null deletes the key. Inputs are not mutated.
 */
export function mergePatch<T extends Record<string, unknown>>(target: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === null) delete out[key];
    else if (isPlainObject(value)) out[key] = mergePatch(isPlainObject(out[key]) ? out[key] : {}, value);
    else out[key] = value;
  }
  return out as T;
}

/** An update may omit the name, but never blank it (create already rejects an empty name). */
export function monitorNameError(name: unknown): string | null {
  if (name === undefined) return null;
  return typeof name === "string" && name.trim() && [...name].length <= 255 ? null : "name must be 1-255 characters";
}

/** Synthetic checks run a full browser test, so plans and the form advertise a 5-minute floor. */
export const SYNTHETIC_MIN_FREQUENCY_MINUTES = catalog.syntheticMinIntervalMinutes;

/** Checks the stored-or-new type against the stored-or-new frequency, so changing either one is covered. */
export function syntheticFrequencyError(type: unknown, frequencyMinutes: unknown): string | null {
  if (type !== "synthetic_test" || frequencyMinutes === undefined || frequencyMinutes === null) return null;
  const minutes = Number(frequencyMinutes);
  return !Number.isFinite(minutes) || minutes < SYNTHETIC_MIN_FREQUENCY_MINUTES
    ? `Synthetic monitors can run no more often than every ${SYNTHETIC_MIN_FREQUENCY_MINUTES} minutes`
    : null;
}

export const MIN_FREQUENCY_MINUTES = 1;
export const MAX_FREQUENCY_MINUTES = 1440;

/** One frequency rule for every write path: a whole number of minutes, 1 to 1440. */
export function frequencyMinutesError(value: unknown): string | null {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_FREQUENCY_MINUTES && value <= MAX_FREQUENCY_MINUTES
    ? null
    : `frequencyMinutes must be a whole number between ${MIN_FREQUENCY_MINUTES} and ${MAX_FREQUENCY_MINUTES} minutes`;
}

/**
 * A check that may run longer than the interval overlaps the next one. Only a change that makes the pair worse is
 * rejected, so a stored monitor whose timeout already exceeds its interval keeps saving unrelated edits (the form
 * always sends the full config) and any change that narrows the gap is allowed. `previous` is null on create.
 */
export function timeoutFrequencyError(
  previous: { config: MonitorConfig | null | undefined; frequencyMinutes: number } | null,
  next: { config: MonitorConfig | null | undefined; frequencyMinutes: unknown },
): string | null {
  const timeout = next.config?.timeoutSeconds;
  if (typeof timeout !== "number" || typeof next.frequencyMinutes !== "number") return null;
  const excess = timeout - next.frequencyMinutes * 60;
  if (excess <= 0) return null;
  const priorTimeout = previous?.config?.timeoutSeconds;
  const priorExcess = typeof priorTimeout === "number" && previous ? priorTimeout - previous.frequencyMinutes * 60 : 0;
  if (excess <= priorExcess) return null;
  return `config.timeoutSeconds (${timeout}) cannot exceed the check interval of ${next.frequencyMinutes * 60} seconds`;
}

/**
 * Name and customMessage cleanup shared by create, both PUTs and PATCH. The target and credentials are never rewritten
 * (a password such as `ab${x}` or a `?token=ab${x}` query must reach the check as typed); the target is validated instead
 * (URL shape, target policy, length). It is only ever rendered as escaped React text, and a link is only built from a validated http(s) URL.
 */
export function sanitizeMonitorFields(body: Record<string, unknown>): void {
  // Trim only: the target is validated (length, control characters, shape, policy), never rewritten.
  if (typeof body.target === "string") body.target = body.target.trim();
  if (typeof body.name === "string") body.name = sanitizeString(body.name);
  const alert = body.alertConfig as Record<string, unknown> | null | undefined;
  if (alert && typeof alert.customMessage === "string" && alert.customMessage) {
    alert.customMessage = sanitizeString(alert.customMessage);
  }
}

/** Services throw plain `{ statusCode, message }` objects; map them to a response instead of a 500. */
export function thrownStatusResponse(error: unknown): NextResponse | null {
  if (!error || typeof error !== "object" || error instanceof Error) return null;
  const { statusCode, message, errors } = error as { statusCode?: unknown; message?: unknown; errors?: unknown };
  if (typeof statusCode !== "number" || statusCode < 400 || statusCode > 599) return null;
  return NextResponse.json(
    { error: typeof message === "string" ? message : "Request failed", ...(errors ? { details: errors } : {}) },
    { status: statusCode },
  );
}

/** Rows are synced only when the write carries the provider list (or clears alertConfig), so drifted rows are not deleted by an unrelated threshold edit. */
export function alertProvidersSent(alertConfig: unknown): boolean {
  if (alertConfig === null) return true;
  return typeof alertConfig === "object" && !Array.isArray(alertConfig) && Object.hasOwn(alertConfig as object, "notificationProviders");
}

/** True when the stored job state disagrees with the row: an active monitor with no job id, or an inactive one that still has one. */
export function scheduleOutOfSync(row: { enabled: boolean; status: string; frequencyMinutes: number; scheduledJobId: string | null }): boolean {
  const shouldRun = row.enabled && row.status !== "paused" && row.frequencyMinutes > 0;
  return shouldRun !== Boolean(row.scheduledJobId);
}

/** After stale provider ids are dropped, the alert must still be valid (a channel unless incidents are on). */
export function assertKeptProvidersValid(config: AlertConfig, kept: string[]): void {
  const error = enabledAlertConfigError({ ...config, notificationProviders: kept });
  if (error) throw new AlertConfigConflictError(error);
}

export const SCHEDULE_FAILURE_MESSAGE = "Monitor saved, but updating the check schedule failed. Retry the request to reconcile it.";

/** The row is saved but the repeatable job could not be brought in line; routes answer 503 so the client retries. */
export class MonitorScheduleError extends Error {
  /** The committed row, so the route can still audit the change. */
  constructor(cause: unknown, readonly monitor?: typeof monitors.$inferSelect) {
    super(SCHEDULE_FAILURE_MESSAGE, { cause });
  }
}

export function scheduleFailureResponse(error: unknown): NextResponse | null {
  return error instanceof MonitorScheduleError ? NextResponse.json({ error: error.message }, { status: 503 }) : null;
}
