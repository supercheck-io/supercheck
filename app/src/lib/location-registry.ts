/**
 * Location Registry — Single source of truth for location queries.
 *
 * All location data flows from the `locations` DB table through this module.
 * In-memory cache avoids DB hits on every queue operation.
 * Cache is invalidated explicitly after CRUD and refreshed automatically after TTL.
 */
import { db } from "@/utils/db";
import { locations, projectLocations } from "@/db/schema/locations";
import { eq, and, asc, inArray } from "drizzle-orm";

export type Location = typeof locations.$inferSelect;

interface ProjectLocationAvailability {
  locations: Location[];
  hasRestrictions: boolean;
}

// ── In-Memory Cache ─────────────────────────────────────────────
interface LocationCache {
  enabledCodes: string[];
  defaultCodes: string[];
  firstDefaultCode: string;
  allEnabled: Location[];
  expiresAt: number;
}

let cache: LocationCache | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

async function ensureCache(): Promise<LocationCache> {
  if (cache && Date.now() < cache.expiresAt) return cache;

  const enabled = await db
    .select()
    .from(locations)
    .where(eq(locations.isEnabled, true))
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));

  const enabledCodes = enabled.map((l) => l.code);
  const defaultCodes = enabled.filter((l) => l.isDefault).map((l) => l.code);
  const firstDefaultCode =
    defaultCodes[0] || enabledCodes[0] || "local";

  cache = {
    enabledCodes,
    defaultCodes,
    firstDefaultCode,
    allEnabled: enabled,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return cache;
}

/** Invalidate the location cache. Call after any location CRUD operation. */
export function invalidateLocationCache(): void {
  cache = null;
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

/** Get the first default location code. Cached. */
export async function getFirstDefaultLocationCode(): Promise<string> {
  return (await ensureCache()).firstDefaultCode;
}

/** Get all enabled locations (full objects). Cached. */
export async function getEnabledLocations(): Promise<Location[]> {
  return (await ensureCache()).allEnabled;
}

/** Get all locations (including disabled). Super Admin use only. Uncached. */
export async function getAllLocations(): Promise<Location[]> {
  return db
    .select()
    .from(locations)
    .orderBy(asc(locations.sortOrder), asc(locations.createdAt));
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
    .select({ locationId: projectLocations.locationId })
    .from(projectLocations)
    .where(eq(projectLocations.projectId, projectId));

  if (restrictions.length === 0) {
    // No restrictions — all enabled locations
    return {
      locations: await getEnabledLocations(),
      hasRestrictions: false,
    };
  }

  const restrictedIds = restrictions.map((r) => r.locationId);
  return {
    locations: await db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.isEnabled, true),
          inArray(locations.id, restrictedIds)
        )
      )
      .orderBy(asc(locations.sortOrder), asc(locations.createdAt)),
    hasRestrictions: true,
  };
}

export async function getProjectAvailableLocationCodes(
  projectId: string
): Promise<string[]> {
  return (await getProjectAvailableLocations(projectId)).map((location) => location.code);
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

export async function getFirstProjectAvailableLocationCode(
  projectId: string
): Promise<string> {
  const { locations: availableLocations, hasRestrictions } =
    await getProjectLocationAvailability(projectId);
  const defaultCode = availableLocations.find((location) => location.isDefault)?.code;

  if (defaultCode) return defaultCode;
  if (availableLocations[0]?.code) return availableLocations[0].code;

  // If the project has explicit restrictions but all restricted locations are disabled,
  // do NOT fall through to the instance-wide default — that would bypass the restriction.
  if (hasRestrictions) {
    throw new Error(
      "All restricted locations for this project are currently disabled. " +
        "Enable at least one assigned location or remove the project restrictions."
    );
  }

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
 * Returns the validated code or falls back to the first default location.
 * "global" is always accepted (K6 queue routing treats it as any-worker).
 */
export async function normalizeK6Location(value?: string | null): Promise<string> {
  if (!value) return getFirstDefaultLocationCode();
  const lower = value.toLowerCase();
  if (lower === "global") return "global";
  const valid = await validateLocationCode(lower);
  if (valid) return lower;
  return getFirstDefaultLocationCode();
}

export async function resolveProjectK6Location(
  projectId: string,
  value?: string | null
): Promise<string> {
  if (!value) {
    return getFirstProjectAvailableLocationCode(projectId);
  }

  const normalizedValue = value.toLowerCase();

  if (normalizedValue === "global") {
    const hasRestrictions = await hasProjectLocationRestrictions(projectId);
    if (hasRestrictions) {
      throw new Error(
        'The "global" location is not available when project location restrictions are enabled.'
      );
    }
    return "global";
  }

  const availableCodes = await getProjectAvailableLocationCodes(projectId);
  if (!availableCodes.includes(normalizedValue)) {
    throw new Error(`Location code is not available for this project: ${normalizedValue}`);
  }

  return normalizedValue;
}
