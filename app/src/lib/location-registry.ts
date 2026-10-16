/**
 * Location Registry — Single source of truth for location queries.
 *
 * All location data flows from the `locations` DB table through this module.
 * In-memory cache avoids DB hits on every queue operation.
 * Cache is invalidated explicitly after CRUD and refreshed automatically after TTL.
 *
 * The "local" location is restricted to self-hosted deployments only.
 * In cloud mode, "local" is filtered from all user-facing queries but
 * remains in the DB as a fallback for self-hosted installations.
 */
import { db } from "@/utils/db";
import { locations, projectLocations } from "@/db/schema/locations";
import { eq, and, asc, inArray } from "drizzle-orm";
import { isSelfHosted } from "@/lib/feature-flags";

export type Location = typeof locations.$inferSelect;

/**
 * The "local" location code. This location is only available in self-hosted mode.
 * In cloud mode it is filtered from all user-facing queries (enabled locations,
 * available locations, default location fallback) but remains in the DB so
 * self-hosted installations continue to work out of the box.
 */
export const LOCAL_LOCATION_CODE = "local";
export const PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR =
  "All restricted locations for this project are currently disabled. " +
  "Enable at least one assigned location or remove the project restrictions.";

/**
 * Workloads a location can be asked to run.
 * - "monitor": HTTP/SSL/ping/port probes. Always allowed in an enabled location.
 * - "browser": Playwright execution (synthetic monitors, tests, CI jobs).
 * - "k6": k6 performance tests pinned to a location.
 */
export type LocationWorkload = "monitor" | "browser" | "k6";

/** Thrown when no eligible location exists for a workload (never falls back across geographies). */
export class LocationWorkloadUnavailableError extends Error {
  constructor(
    public readonly workload: LocationWorkload,
    message?: string
  ) {
    super(message ?? workloadUnavailableMessage(workload));
    this.name = "LocationWorkloadUnavailableError";
  }
}

export function workloadUnavailableMessage(workload: LocationWorkload): string {
  switch (workload) {
    case "browser":
      return "Browser checks are not available in this region.";
    case "k6":
      return "Performance tests are not available in this region.";
    default:
      return "This workload is not available in this region.";
  }
}

/** Capability predicate shared by every validator, resolver and picker. */
export function locationSupportsWorkload(
  location: Pick<Location, "supportsBrowser" | "supportsK6">,
  workload: LocationWorkload
): boolean {
  if (workload === "browser") return location.supportsBrowser;
  if (workload === "k6") return location.supportsK6;
  return true;
}

/** Returns true when the "local" location should be excluded (i.e., cloud mode). */
export function shouldExcludeLocal(): boolean {
  return !isSelfHosted();
}

/** Filter out "local" from a location array when running in cloud mode. */
function filterLocal<T extends { code: string }>(locs: T[]): T[] {
  return shouldExcludeLocal() ? locs.filter((l) => l.code !== LOCAL_LOCATION_CODE) : locs;
}

/**
 * Remove restrictions that are hidden by the current hosting mode.
 * In cloud mode, stale `"local"` rows must not keep a project in a
 * restricted-but-empty state.
 */
export function getVisibleProjectRestrictions<T extends { code: string }>(
  restrictions: T[]
): T[] {
  return shouldExcludeLocal()
    ? restrictions.filter((restriction) => restriction.code !== LOCAL_LOCATION_CODE)
    : restrictions;
}

interface ProjectLocationAvailability {
  locations: Location[];
  hasRestrictions: boolean;
}

type ProjectLocationRestriction = {
  locationId: string;
  code: string;
};

type ProjectLocationRestrictionCode = {
  code: string;
};

// ── In-Memory Cache ─────────────────────────────────────────────
interface LocationCache {
  enabledCodes: string[];
  defaultCodes: string[];
  firstDefaultCode: string;
  allEnabled: Location[];
  expiresAt: number;
}

const LOCATION_CACHE_KEY = "__SUPERCHECK_LOCATION_CACHE__";
const CACHE_TTL_MS = 30_000; // 30 seconds

type LocationCacheState = {
  cache: LocationCache | null;
  pending: Promise<LocationCache> | null;
  revision: number;
};
const scope = globalThis as typeof globalThis & {
  [LOCATION_CACHE_KEY]?: LocationCacheState;
};
const cacheState = scope[LOCATION_CACHE_KEY] ??= { cache: null, pending: null, revision: 0 };

async function ensureCache(): Promise<LocationCache> {
  if (cacheState.cache && Date.now() < cacheState.cache.expiresAt) return cacheState.cache;
  if (cacheState.pending) return cacheState.pending;
  const revision = cacheState.revision;
  const pending = readLocations(revision);
  cacheState.pending = pending;
  try {
    return await pending;
  } finally {
    // Compare the revision, not the promise. CodeQL treats a promise
    // identity check as a missing await.
    if (cacheState.revision === revision) cacheState.pending = null;
  }
}

async function readLocations(revision: number): Promise<LocationCache> {
  const enabled = await db
    .select()
    .from(locations)
    .where(eq(locations.isEnabled, true))
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));

  // Apply cloud-mode filtering: exclude "local" in non-self-hosted deployments
  const filtered = filterLocal(enabled);

  const enabledCodes = filtered.map((l) => l.code);
  const defaultCodes = filtered.filter((l) => l.isDefault).map((l) => l.code);
  const firstDefaultCode =
    defaultCodes[0] || enabledCodes[0] || (isSelfHosted() ? LOCAL_LOCATION_CODE : "");

  const next = {
    enabledCodes,
    defaultCodes,
    firstDefaultCode,
    allEnabled: filtered,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  // A location save can complete while this query is in flight.
  if (revision !== cacheState.revision) return ensureCache();
  cacheState.cache = next;

  return next;
}

/** Invalidate the location cache. Call after any location CRUD operation. */
export function invalidateLocationCache(): void {
  cacheState.revision++;
  cacheState.cache = null;
  cacheState.pending = null;
}

// ── Public Query Functions ──────────────────────────────────────

/** Get all enabled location codes. Cached. */
export async function getAllEnabledLocationCodes(): Promise<string[]> {
  return (await ensureCache()).enabledCodes;
}

/** Get default location codes (is_default=true). Cached. */
export async function getDefaultLocationCodes(): Promise<string[]> {
  return (await ensureCache()).defaultCodes;
}

/**
 * Get the first default location code. Cached.
 *
 * In self-hosted mode, ultimate fallback is "local".
 * In cloud mode, throws if no enabled locations exist (no silent fallback to "local").
 */
export async function getFirstDefaultLocationCode(): Promise<string> {
  const code = (await ensureCache()).firstDefaultCode;
  if (!code) {
    throw new Error(
      "No enabled locations available. Create and enable at least one location in Super Admin."
    );
  }
  return code;
}

/** Get all enabled locations (full objects). Cached. */
export async function getEnabledLocations(): Promise<Location[]> {
  return (await ensureCache()).allEnabled;
}

/**
 * Get all locations (including disabled). Super Admin use only. Uncached.
 *
 * In cloud mode, the "local" location is filtered out because it is only
 * meaningful for self-hosted deployments. This prevents it from appearing
 * in the Super Admin Locations table in cloud-hosted mode.
 */
export async function getAllLocations(): Promise<Location[]> {
  const all = await db
    .select()
    .from(locations)
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));
  return filterLocal(all);
}

/** Display-only fields, including disabled regions; never use for scheduling. */
export async function getLocationDisplayData() {
  const rows = await db.select({
    code: locations.code,
    name: locations.name,
    region: locations.region,
    flag: locations.flag,
    coordinates: locations.coordinates,
    isEnabled: locations.isEnabled,
  }).from(locations).orderBy(asc(locations.sortOrder), asc(locations.createdAt));
  return filterLocal(rows);
}

/**
 * Get locations available for a specific project.
 * If the project has no rows in project_locations, returns all enabled locations.
 * Otherwise, returns the intersection of enabled locations and project restrictions.
 */
export async function getProjectAvailableLocations(
  projectId: string
): Promise<Location[]> {
  return (await getProjectLocationAvailability(projectId)).locations;
}

async function getProjectLocationAvailability(
  projectId: string
): Promise<ProjectLocationAvailability> {
  const restrictions = await db
    .select({
      locationId: projectLocations.locationId,
      code: locations.code,
    })
    .from(projectLocations)
    .innerJoin(locations, eq(projectLocations.locationId, locations.id))
    .where(eq(projectLocations.projectId, projectId));

  const visibleRestrictions =
    getVisibleProjectRestrictions<ProjectLocationRestriction>(restrictions);

  if (visibleRestrictions.length === 0) {
    // No restrictions — all enabled locations
    return {
      locations: await getEnabledLocations(),
      hasRestrictions: false,
    };
  }

  const restrictedIds = visibleRestrictions.map((restriction) => restriction.locationId);
  const restricted = await db
    .select()
    .from(locations)
    .where(
      and(
        eq(locations.isEnabled, true),
        inArray(locations.id, restrictedIds)
      )
    )
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));

  // Apply cloud-mode filtering: exclude "local" from project-restricted
  // queries too.  Without this, a project with an explicit project_locations
  // row pointing at "local" would still surface and accept "local" via
  // /api/locations/available and monitor/K6 validation in cloud mode.
  return {
    locations: filterLocal(restricted),
    hasRestrictions: true,
  };
}

export async function getProjectAvailableLocationCodes(
  projectId: string,
  workload?: LocationWorkload
): Promise<string[]> {
  const available = await getProjectAvailableLocations(projectId);
  return (workload
    ? available.filter((location) => locationSupportsWorkload(location, workload))
    : available
  ).map((location) => location.code);
}

/** Enabled location codes (instance-wide) that can run the given workload. Cached. */
export async function getWorkloadCapableLocationCodes(
  workload: LocationWorkload
): Promise<string[]> {
  return (await getEnabledLocations())
    .filter((location) => locationSupportsWorkload(location, workload))
    .map((location) => location.code);
}

/** True when the code is enabled and supports the workload. Unknown codes are never capable. */
export async function isLocationCapable(
  code: string,
  workload: LocationWorkload
): Promise<boolean> {
  const location = (await getEnabledLocations()).find((l) => l.code === code);
  return !!location && locationSupportsWorkload(location, workload);
}

/**
 * Playwright tests and CI jobs have no location of their own: they run on the
 * location-less `playwright-global` queue. This rejects a project whose permitted
 * locations are all probe-only. It does not choose where the global queue runs:
 * workers consuming it pause themselves when their own location lacks
 * `supports_browser` (see GlobalQueueCapabilityGuard), and WORKER_QUEUES decides
 * which workers consume it at all.
 */
export async function assertProjectSupportsBrowser(projectId: string): Promise<void> {
  const permitted = await getProjectAvailableLocations(projectId);
  // Only block when the project has locations and every one is probe-only.
  // A project with no usable locations at all keeps the pre-capability
  // behaviour (global queue), so this gate never newly breaks existing setups.
  if (
    permitted.length > 0 &&
    !permitted.some((location) => locationSupportsWorkload(location, "browser"))
  ) {
    throw new LocationWorkloadUnavailableError("browser");
  }
}

export async function hasProjectLocationRestrictions(
  projectId: string
): Promise<boolean> {
  return (await getProjectLocationAvailability(projectId)).hasRestrictions;
}

export async function getProjectAvailableLocationsWithMeta(
  projectId: string
): Promise<ProjectLocationAvailability> {
  return getProjectLocationAvailability(projectId);
}

/**
 * Returns the first visible project restriction code, including disabled
 * locations. This is used for scheduler failure reporting so a project with
 * disabled-but-assigned locations can still be marked down against a real
 * location instead of a synthetic fallback.
 */
export async function getFirstVisibleProjectRestrictionCode(
  projectId: string
): Promise<string | undefined> {
  const restrictions = await db
    .select({
      code: locations.code,
    })
    .from(projectLocations)
    .innerJoin(locations, eq(projectLocations.locationId, locations.id))
    .where(eq(projectLocations.projectId, projectId))
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));

  return getVisibleProjectRestrictions<ProjectLocationRestrictionCode>(
    restrictions
  )[0]?.code;
}

export async function getFirstProjectAvailableLocationCode(
  projectId: string,
  workload?: LocationWorkload
): Promise<string> {
  const availability = await getProjectLocationAvailability(projectId);
  const { hasRestrictions } = availability;
  const availableLocations = workload
    ? availability.locations.filter((location) => locationSupportsWorkload(location, workload))
    : availability.locations;
  const defaultCode = availableLocations.find((location) => location.isDefault)?.code;

  if (defaultCode) return defaultCode;
  if (availableLocations[0]?.code) return availableLocations[0].code;

  // If the project has explicit restrictions but all restricted locations are disabled,
  // do NOT fall through to the instance-wide default — that would bypass the restriction.
  if (hasRestrictions) {
    // Distinguish "assigned locations exist but cannot run this workload" from "all disabled".
    if (workload && availability.locations.length > 0) {
      throw new LocationWorkloadUnavailableError(workload);
    }
    throw new Error(PROJECT_RESTRICTED_LOCATIONS_DISABLED_ERROR);
  }

  // No restrictions and nothing capable: never fall back to an incapable location.
  if (workload) throw new LocationWorkloadUnavailableError(workload);

  return getFirstDefaultLocationCode();
}

/** Validate that a location code exists and is enabled. Uses cache. */
export async function validateLocationCode(code: string): Promise<boolean> {
  const codes = await getAllEnabledLocationCodes();
  return codes.includes(code);
}

/** Look up a location by code. Uncached, for display use. */
export async function getLocationByCode(
  code: string
): Promise<Location | undefined> {
  const [row] = await db
    .select()
    .from(locations)
    .where(eq(locations.code, code))
    .limit(1);
  return row;
}

/**
 * Normalize and validate a K6 location code against the DB.
 * Returns the validated code or the first default when omitted.
 * "global" is always accepted (K6 queue routing treats it as any-worker).
 * "local" is rejected in cloud mode (self-hosted only).
 */
export async function normalizeK6Location(value?: string | null): Promise<string> {
  if (!value) return getFirstDefaultLocationCode();
  const lower = value.toLowerCase();
  if (lower === "global") return "global";
  if (lower === LOCAL_LOCATION_CODE && shouldExcludeLocal()) {
    throw new Error('The "local" location is only available on self-hosted deployments.');
  }
  const valid = await validateLocationCode(lower);
  if (valid) return lower;
  throw new Error(`Location code is not enabled: ${lower}`);
}

export async function resolveProjectK6Location(
  projectId: string,
  value?: string | null
): Promise<string> {
  if (!value) {
    return getFirstProjectAvailableLocationCode(projectId, "k6");
  }

  const normalizedValue = value.toLowerCase();

  if (normalizedValue === "global") {
    const hasRestrictions = await hasProjectLocationRestrictions(projectId);
    if (hasRestrictions) {
      throw new Error(
        'The "global" location is not available when project location restrictions are enabled.'
      );
    }
    // "global" means consumption by eligible k6 workers; with no k6-capable
    // location there is nowhere eligible to run it.
    if ((await getWorkloadCapableLocationCodes("k6")).length === 0) {
      throw new LocationWorkloadUnavailableError("k6");
    }
    return "global";
  }

  const availableCodes = await getProjectAvailableLocationCodes(projectId);
  if (!availableCodes.includes(normalizedValue)) {
    throw new Error(`Location code is not available for this project: ${normalizedValue}`);
  }
  if (!(await isLocationCapable(normalizedValue, "k6"))) {
    throw new LocationWorkloadUnavailableError("k6");
  }

  return normalizedValue;
}
