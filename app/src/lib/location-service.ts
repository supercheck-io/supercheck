import { MONITORING_LOCATIONS } from "@/db/schema";
import type {
  MonitoringLocation,
  LocationMetadata,
  LocationConfig,
} from "@/db/schema";

// Re-export key pieces for UI usage
export { MONITORING_LOCATIONS };
export type { MonitoringLocation, LocationConfig };

/**
 * Location metadata for all available monitoring locations.
 * Includes display names, regions, and geographic coordinates.
 */
export const LOCATION_METADATA: Record<MonitoringLocation, LocationMetadata> = {
  [MONITORING_LOCATIONS.US_EAST]: {
    code: MONITORING_LOCATIONS.US_EAST,
    name: "US East",
    region: "Ashburn",
    coordinates: { lat: 39.0438, lon: -77.4874 },
    flag: "🇺🇸",
  },
  [MONITORING_LOCATIONS.EU_CENTRAL]: {
    code: MONITORING_LOCATIONS.EU_CENTRAL,
    name: "EU Central",
    region: "Nuremberg",
    coordinates: { lat: 49.4521, lon: 11.0767 },
    flag: "🇩🇪",
  },
  [MONITORING_LOCATIONS.ASIA_PACIFIC]: {
    code: MONITORING_LOCATIONS.ASIA_PACIFIC,
    name: "Asia Pacific",
    region: "Singapore",
    coordinates: { lat: 1.3521, lon: 103.8198 },
    flag: "🇸🇬",
  },
};


const ALL_MONITORING_LOCATIONS = Object.values(
  MONITORING_LOCATIONS
) as MonitoringLocation[];

/**
 * Default location configuration for new monitors.
 */
export const DEFAULT_LOCATION_CONFIG: LocationConfig = {
  enabled: false,
  locations: [MONITORING_LOCATIONS.EU_CENTRAL],
  threshold: 50, // Majority must be up
  strategy: "majority",
};

/**
 * Get all available monitoring locations.
 */
export function getAllLocations(): LocationMetadata[] {
  return Object.values(LOCATION_METADATA);
}

/**
 * Get metadata for a specific location.
 */
export function getLocationMetadata(
  location: MonitoringLocation
): LocationMetadata | undefined {
  return LOCATION_METADATA[location];
}

/**
 * Get display name for a location.
 */
export function getLocationDisplayName(location: MonitoringLocation): string {
  return LOCATION_METADATA[location]?.name || location;
}

export function isMonitoringLocation(
  value: unknown
): value is MonitoringLocation {
  if (typeof value !== "string") {
    return false;
  }
  return ALL_MONITORING_LOCATIONS.includes(value as MonitoringLocation);
}

/**
 * Validate location configuration.
 */
export function validateLocationConfig(
  config: Partial<LocationConfig>
): { valid: boolean; error?: string } {
  if (!config) {
    return { valid: false, error: "Location config is required" };
  }

  if (config.enabled && (!config.locations || config.locations.length === 0)) {
    return {
      valid: false,
      error: "At least one location must be selected when enabled",
    };
  }

  if (config.locations) {
    for (const location of config.locations) {
      if (!LOCATION_METADATA[location]) {
        return { valid: false, error: `Invalid location: ${location}` };
      }
    }
  }

  if (
    config.threshold !== undefined &&
    (config.threshold < 0 || config.threshold > 100)
  ) {
    return {
      valid: false,
      error: "Threshold must be between 0 and 100",
    };
  }

  return { valid: true };
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

  const upCount = locations.filter(
    (loc) => locationStatuses[loc] === true
  ).length;
  const totalCount = locations.length;
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
export function getEffectiveLocations(
  config?: LocationConfig | null
): MonitoringLocation[] {
  if (!config || !config.enabled) {
    // Single location mode - use default primary location
    return [MONITORING_LOCATIONS.EU_CENTRAL];
  }

  // Normalize legacy locations
  const locations = config.locations || [MONITORING_LOCATIONS.EU_CENTRAL];
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
