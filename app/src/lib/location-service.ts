import { MONITORING_LOCATIONS } from "@/db/schema";
import type {
  MonitoringLocation,
  LocationMetadata,
  LocationConfig,
} from "@/db/schema";

// Re-export key types for UI usage
export type { MonitoringLocation, LocationConfig };

/**
 * Static location metadata for the three cloud defaults.
 *
 * @deprecated For client components, prefer the `useLocations()` hook
 * from `@/hooks/use-locations` which fetches dynamic data from the DB.
 * This constant is retained as a server-side / SSR fallback so existing
 * callers keep working without breaking changes.
 */
export const LOCATION_METADATA: Record<string, LocationMetadata> = {
  local: {
    code: "local",
    name: "Local",
    region: "Default",
    coordinates: { lat: 49.4521, lon: 11.0767 },
    flag: "🖥️",
  },
  "us-east": {
    code: "us-east",
    name: "US East",
    region: "Ashburn",
    coordinates: { lat: 39.0438, lon: -77.4874 },
    flag: "🇺🇸",
  },
  "eu-central": {
    code: "eu-central",
    name: "EU Central",
    region: "Nuremberg",
    coordinates: { lat: 49.4521, lon: 11.0767 },
    flag: "🇩🇪",
  },
  "asia-pacific": {
    code: "asia-pacific",
    name: "Asia Pacific",
    region: "Singapore",
    coordinates: { lat: 1.3521, lon: 103.8198 },
    flag: "🇸🇬",
  },
};

/**
 * Build a metadata lookup from dynamic location data (e.g. from API/hook).
 * Use this in client components instead of the static LOCATION_METADATA.
 */
export function buildLocationMetadataMap(
  locations: Array<{
    code: string;
    name: string;
    region: string | null;
    flag: string | null;
    coordinates: { lat: number; lon: number } | null;
  }>
): Record<string, LocationMetadata> {
  const map: Record<string, LocationMetadata> = {};
  for (const loc of locations) {
    map[loc.code] = {
      code: loc.code,
      name: loc.name,
      region: loc.region || "",
      coordinates: loc.coordinates ?? undefined,
      flag: loc.flag ?? undefined,
    };
  }
  return map;
}

/**
 * Default location configuration for new monitors.
 */
export const DEFAULT_LOCATION_CONFIG: LocationConfig = {
  enabled: false,
  locations: ["local"],
  threshold: 50, // Majority must be up
  strategy: "majority",
};

/**
 * Get metadata for a specific location.
 * Falls back to LOCATION_METADATA for known defaults;
 * returns a generated entry for unknown codes.
 */
export function getLocationMetadata(
  location: string
): LocationMetadata | undefined {
  return LOCATION_METADATA[location];
}

export function isMonitoringLocation(
  value: unknown
): value is MonitoringLocation {
  if (typeof value !== "string") {
    return false;
  }
  // With dynamic locations, any non-empty string is a valid location code
  return value.length > 0;
}

/**
 * Normalize legacy uppercase location values to kebab-case
 */
export function normalizeLegacyLocation(location: string): MonitoringLocation {
  const upperLocation = location.trim().toUpperCase();

  switch (upperLocation) {
    case 'US':
    case 'US_EAST':
    case 'US-EAST':
    case 'US EAST':
      return MONITORING_LOCATIONS.US_EAST;
    case 'EU':
    case 'EU_CENTRAL':
    case 'EU-CENTRAL':
    case 'EU CENTRAL':
      return MONITORING_LOCATIONS.EU_CENTRAL;
    case 'APAC':
    case 'ASIA_PACIFIC':
    case 'ASIA-PACIFIC':
    case 'ASIA PACIFIC':
      return MONITORING_LOCATIONS.ASIA_PACIFIC;
    default:
      // Already in correct format or default to EU Central
      return location as MonitoringLocation;
  }
}

/**
 * Calculate the overall status based on location results and threshold.
 */
export function calculateAggregatedStatus(
  locationStatuses: Record<MonitoringLocation, boolean>,
  config: LocationConfig
): "up" | "down" | "partial" {
  const rawLocations = config.locations || [];
  if (rawLocations.length === 0) {
    return "down";
  }

  // Normalize locations to ensure they match the keys in locationStatuses
  const locations = rawLocations.map((loc) =>
    normalizeLegacyLocation(loc),
  );

  // If none of the configured locations exist in the actual results,
  // fall back to using the result locations directly. This handles
  // cases where monitor config has stale location codes.
  const resultKeys = Object.keys(locationStatuses);
  const hasOverlap = locations.some((loc) => resultKeys.includes(loc));
  const effectiveLocations = hasOverlap ? locations : resultKeys;

  const upCount = effectiveLocations.filter(
    (loc) => locationStatuses[loc] === true
  ).length;
  const totalCount = effectiveLocations.length;
  const upPercentage = (upCount / totalCount) * 100;
  const threshold =
    typeof config.threshold === "number" ? config.threshold : 50;
  const anyUp = upCount > 0;

  // Apply strategy (default to "majority" if not specified)
  const strategy = config.strategy || "majority";
  switch (strategy) {
    case "all":
      if (upCount === totalCount) {
        return "up";
      }
      return anyUp ? "partial" : "down";
    case "any":
      return upCount > 0 ? "up" : "down";
    case "majority":
    default:
      if (upPercentage >= threshold) {
        return "up";
      }
      return anyUp ? "partial" : "down";
  }
}

/**
 * Get the effective locations for a monitor (handles legacy and multi-location configs).
 */
/** @deprecated Use resolveMonitorLocations() in queue.ts or getEffectiveLocations() in monitor-scheduler.ts instead. */
export function getEffectiveLocations(
  config?: LocationConfig | null
): MonitoringLocation[] {
  if (!config || !config.enabled) {
    // Single location mode - use default primary location
    return ["local"];
  }

  // Normalize legacy locations
  const locations = config.locations || ["local"];
  return locations.map(loc => normalizeLegacyLocation(loc));
}

/**
 * Format location status for display.
 */
export function formatLocationStatus(
  isUp: boolean,
  responseTimeMs?: number | null
): string {
  if (!isUp) {
    return "Down";
  }

  if (responseTimeMs !== null && responseTimeMs !== undefined) {
    return `${responseTimeMs}ms`;
  }

  return "Up";
}

/**
 * Get location health percentage based on recent results.
 */
export function calculateLocationHealth(
  totalChecks: number,
  upChecks: number
): number {
  if (totalChecks === 0) return 0;
  return Math.round((upChecks / totalChecks) * 100);
}

/**
 * Determine the color class for a location based on its health.
 */
export function getLocationHealthColor(healthPercentage: number): string {
  if (healthPercentage >= 99) return "text-green-600 bg-green-100";
  if (healthPercentage >= 95) return "text-green-600 bg-green-50";
  if (healthPercentage >= 90) return "text-yellow-600 bg-yellow-100";
  if (healthPercentage >= 80) return "text-orange-600 bg-orange-100";
  return "text-red-600 bg-red-100";
}
