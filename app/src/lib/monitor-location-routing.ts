import type { LocationConfig } from "@/db/schema";
import {
  getWorkloadCapableLocationCodes,
  type LocationWorkload,
  getAllEnabledLocationCodes,
  getDefaultLocationCodes,
  getFirstDefaultLocationCode,
  getProjectAvailableLocationCodes,
  hasProjectLocationRestrictions,
  PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR,
} from "@/lib/location-registry";
import { getActiveWorkerQueueNames } from "@/lib/worker-registry";

const MONITOR_CONFIGURED_LOCATIONS_UNAVAILABLE_PREFIX =
  "Monitor has locations explicitly configured [";

const MONITOR_WORKLOAD_UNAVAILABLE_PREFIX = "Monitor locations unavailable for ";

export function isMonitorLocationResolutionError(errorMessage: string): boolean {
  return (
    errorMessage === PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR ||
    errorMessage.startsWith(MONITOR_CONFIGURED_LOCATIONS_UNAVAILABLE_PREFIX) ||
    errorMessage.startsWith(MONITOR_WORKLOAD_UNAVAILABLE_PREFIX)
  );
}

export interface ResolveMonitorLocationsOptions {
  /** Monitor type; synthetic (Playwright) monitors only resolve to browser-capable locations. */
  monitorType?: string | null;
}

/** HTTP/ping/port/SSL probes are unrestricted; only synthetic monitors need browser capability. */
export function getMonitorWorkload(monitorType?: string | null): LocationWorkload {
  return monitorType === "synthetic_test" ? "browser" : "monitor";
}

function workloadUnavailableError(workload: LocationWorkload): Error {
  return new Error(
    `${MONITOR_WORKLOAD_UNAVAILABLE_PREFIX}${workload === "browser" ? "browser checks" : workload}: ` +
      "no eligible location supports this monitor type. Update the monitor's location " +
      "configuration or enable the capability for a location in Super Admin."
  );
}

/**
 * Resolve effective monitor locations from DB, with multi-tier fallback.
 * Validates configured locations against enabled locations in the DB,
 * falling back to defaults -> all enabled -> first default location if none are valid.
 * When projectId is provided, further restricts to project-allowed locations.
 * Note: "local" location is only available in self-hosted mode.
 */
export async function resolveMonitorLocations(
  locationConfig: LocationConfig | null,
  projectId?: string,
  options: ResolveMonitorLocationsOptions = {}
): Promise<string[]> {
  const workload = getMonitorWorkload(options.monitorType);
  if (!locationConfig || !locationConfig.enabled) {
    return resolveDefaultMonitorLocations(projectId, options);
  }

  const configuredLocations = locationConfig.locations;
  if (!configuredLocations || configuredLocations.length === 0) {
    return resolveDefaultMonitorLocations(projectId, options);
  }

  const enabledCodes = new Set(
    workload === "monitor"
      ? await getAllEnabledLocationCodes()
      : await getWorkloadCapableLocationCodes(workload)
  );
  let validLocations = Array.from(
    new Set(configuredLocations.filter((location) => enabledCodes.has(location)))
  );

  if (projectId && validLocations.length > 0) {
    const projectCodes = new Set(await getProjectAvailableLocationCodes(projectId));
    validLocations = validLocations.filter((location) => projectCodes.has(location));
  }

  if (validLocations.length === 0) {
    // Saved selections are never rewritten; surface a configuration error, never another geography.
    throw new Error(
      `${MONITOR_CONFIGURED_LOCATIONS_UNAVAILABLE_PREFIX}${configuredLocations.join(", ")}] ` +
        `but none are currently enabled${workload === "browser" ? " and browser-capable" : ""}` +
        `${projectId ? " for this project" : ""}. ` +
        "Re-enable the locations or update the monitor's location configuration."
    );
  }

  return validLocations;
}

/**
 * Get default monitor locations with a safety fallback chain:
 * default locations -> all enabled -> first default location.
 * Note: "local" is excluded in cloud-hosted mode via location-registry filtering.
 * When projectId is provided and the project has explicit restrictions,
 * filters the resolved defaults to only project-allowed codes.
 */
export async function resolveDefaultMonitorLocations(
  projectId?: string,
  options: ResolveMonitorLocationsOptions = {}
): Promise<string[]> {
  const workload = getMonitorWorkload(options.monitorType);
  if (workload !== "monitor") {
    return resolveCapableDefaultMonitorLocations(projectId, workload);
  }
  const defaults = await getDefaultLocationCodes();
  let resolved: string[];
  if (defaults.length > 0) {
    resolved = defaults;
  } else {
    const enabled = await getAllEnabledLocationCodes();
    if (enabled.length > 0) {
      resolved = enabled;
    } else {
      const fallback = await getFirstDefaultLocationCode();
      resolved = [fallback];
    }
  }

  if (projectId && (await hasProjectLocationRestrictions(projectId))) {
    const projectCodes = await getProjectAvailableLocationCodes(projectId);
    if (projectCodes.length === 0) {
      throw new Error(PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR);
    }
    const filtered = resolved.filter((location) => projectCodes.includes(location));
    if (filtered.length > 0) return filtered;
    return projectCodes;
  }

  return Array.from(new Set(resolved));
}

/**
 * Save-time check: which explicitly selected locations cannot run this monitor type.
 * Only applies when the location config is enabled (a disabled config falls back to
 * capable defaults at runtime). Saved selections are never rewritten — callers reject.
 */
export async function findUnsupportedMonitorLocations(
  locationConfig: LocationConfig | null | undefined,
  monitorType?: string | null
): Promise<string[]> {
  const workload = getMonitorWorkload(monitorType);
  if (workload === "monitor") return [];
  if (!locationConfig?.enabled || !locationConfig.locations?.length) return [];
  const capable = new Set(await getWorkloadCapableLocationCodes(workload));
  return locationConfig.locations.filter((code) => !capable.has(code));
}

/**
 * Selected codes the project may not use (unknown, disabled, or outside its
 * restrictions). Used on update routes so a project editor cannot probe codes
 * that belong to other projects or do not exist.
 */
export async function findLocationsOutsideProject(
  locationConfig: LocationConfig | null | undefined,
  projectId: string
): Promise<string[]> {
  // A disabled location config is inert (the wizard stores the single available
  // code with enabled:false), so a code that later becomes unavailable must not
  // block unrelated edits. It is re-resolved to the project's defaults at runtime.
  if (!locationConfig?.enabled) return [];
  const selected = locationConfig.locations ?? [];
  if (selected.length === 0) return [];
  const allowed = new Set(await getProjectAvailableLocationCodes(projectId));
  return selected.filter((code) => !allowed.has(code));
}

export function unsupportedMonitorLocationsMessage(
  codes: string[],
  monitorType?: string | null
): string {
  const label = getMonitorWorkload(monitorType) === "browser" ? "Browser checks are" : "This monitor type is";
  return `${label} not available in: ${codes.join(", ")}`;
}

/**
 * Defaults for workloads with a capability requirement: capable defaults, else all
 * capable enabled locations, intersected with project permissions. Never escapes
 * project restrictions or falls back to an incapable location.
 */
async function resolveCapableDefaultMonitorLocations(
  projectId: string | undefined,
  workload: LocationWorkload
): Promise<string[]> {
  const capable = new Set(await getWorkloadCapableLocationCodes(workload));
  const defaults = (await getDefaultLocationCodes()).filter((code) => capable.has(code));
  let resolved = defaults.length > 0 ? defaults : Array.from(capable);

  if (projectId) {
    const hasRestrictions = await hasProjectLocationRestrictions(projectId);
    const projectCodes = new Set(await getProjectAvailableLocationCodes(projectId, workload));
    if (hasRestrictions) {
      if (projectCodes.size === 0) {
        const anyAllowed = await getProjectAvailableLocationCodes(projectId);
        if (anyAllowed.length === 0) throw new Error(PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR);
        throw workloadUnavailableError(workload);
      }
      const filtered = resolved.filter((code) => projectCodes.has(code));
      resolved = filtered.length > 0 ? filtered : Array.from(projectCodes);
    }
  }

  if (resolved.length === 0) throw workloadUnavailableError(workload);
  return Array.from(new Set(resolved));
}

/**
 * Split requested monitor locations into online and skipped sets.
 * A location is considered online only when:
 * - the app currently has a BullMQ queue object for that location, and
 * - at least one worker heartbeat advertises the matching regional queue.
 */
export async function partitionMonitorLocationsByAvailability(
  requestedLocations: string[],
  availableQueueLocations: Iterable<string>,
  buildQueueName: (location: string) => string
): Promise<{ enqueuedLocations: string[]; skippedLocations: string[] }> {
  const activeQueueNames = await getActiveWorkerQueueNames().catch((error) => {
    throw new Error(
      `Unable to verify active monitor workers: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  });

  const availableQueues = new Set(availableQueueLocations);
  const enqueuedLocations: string[] = [];
  const skippedLocations: string[] = [];

  for (const location of requestedLocations) {
    const queueName = buildQueueName(location);
    if (availableQueues.has(location) && activeQueueNames.has(queueName)) {
      enqueuedLocations.push(location);
    } else {
      skippedLocations.push(location);
    }
  }

  return { enqueuedLocations, skippedLocations };
}
