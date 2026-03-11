import { Injectable, Logger } from '@nestjs/common';

/**
 * Available monitoring locations for multi-location monitoring.
 * Internal format uses kebab-case (us-east, eu-central, asia-pacific)
 * @deprecated Locations are now dynamic — managed via the `locations` DB table.
 * These constants are kept as defaults for backward compatibility.
 */
export const MONITORING_LOCATIONS = {
  US_EAST: 'us-east',
  EU_CENTRAL: 'eu-central',
  ASIA_PACIFIC: 'asia-pacific',
} as const;

/** @deprecated Use `string` — locations are now dynamic, not a fixed union. */
export type MonitoringLocation = string;

/**
 * Location metadata including display name and geographic information.
 */
export type LocationMetadata = {
  code: string;
  name: string;
  region: string;
  coordinates?: { lat: number; lon: number };
};

/**
 * Configuration for multi-location monitoring.
 */
export type LocationConfig = {
  enabled: boolean;
  locations: string[];
  threshold: number;
  strategy?: 'all' | 'majority' | 'any';
};

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  /**
   * Location metadata for all available monitoring locations.
   * Provides display names and geographic information for UI presentation.
   */
  private readonly locationMetadata: Record<string, LocationMetadata> = {
    local: {
      code: 'local',
      name: 'Local',
      region: 'Default',
      coordinates: { lat: 49.4521, lon: 11.0767 },
    },
    [MONITORING_LOCATIONS.US_EAST]: {
      code: MONITORING_LOCATIONS.US_EAST,
      name: 'US East',
      region: 'Ashburn',
      coordinates: { lat: 39.0438, lon: -77.4874 },
    },
    [MONITORING_LOCATIONS.EU_CENTRAL]: {
      code: MONITORING_LOCATIONS.EU_CENTRAL,
      name: 'EU Central',
      region: 'Nuremberg',
      coordinates: { lat: 49.4521, lon: 11.0767 },
    },
    [MONITORING_LOCATIONS.ASIA_PACIFIC]: {
      code: MONITORING_LOCATIONS.ASIA_PACIFIC,
      name: 'Asia Pacific',
      region: 'Singapore',
      coordinates: { lat: 1.3521, lon: 103.8198 },
    },
  };

  /**
   * Get all available monitoring locations.
   */
  getAllLocations(): LocationMetadata[] {
    return Object.values(this.locationMetadata);
  }

  /**
   * Get metadata for a specific location.
   */
  getLocationMetadata(
    location: string,
  ): LocationMetadata | undefined {
    return this.locationMetadata[location];
  }

  /**
   * Get display name for a location.
   */
  getLocationDisplayName(location: string): string {
    return this.locationMetadata[location]?.name || location;
  }

  /**
   * Validate location configuration.
   */
  validateLocationConfig(config: Partial<LocationConfig>): {
    valid: boolean;
    error?: string;
  } {
    if (!config) {
      return { valid: false, error: 'Location config is required' };
    }

    if (
      config.enabled &&
      (!config.locations || config.locations.length === 0)
    ) {
      return {
        valid: false,
        error: 'At least one location must be selected when enabled',
      };
    }

    if (config.locations) {
      for (const location of config.locations) {
        if (!this.locationMetadata[location]) {
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
        error: 'Threshold must be between 0 and 100',
      };
    }

    return { valid: true };
  }

  /**
   * Get the effective locations for a monitor (handles legacy and multi-location configs).
   */
  getEffectiveLocations(config?: LocationConfig | null): string[] {
    if (!config || !config.enabled) {
      // Single location mode - use default primary location
      return ['local'];
    }

    // Normalize legacy uppercase locations to kebab-case
    const locations = config.locations || ['local'];
    return locations.map((loc) => this.normalizeLegacyLocation(loc));
  }

  /**
   * Normalize legacy uppercase location values to kebab-case
   */
  private normalizeLegacyLocation(location: string): string {
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
        // Already in correct format or unknown — return as-is
        return location;
    }
  }

  /**
   * Calculate the overall status based on location results and threshold.
   */
  calculateAggregatedStatus(
    locationStatuses: Record<string, boolean>,
    config: LocationConfig,
  ): 'up' | 'down' | 'partial' {
    const rawLocations = config.locations || [];
    if (rawLocations.length === 0) {
      return 'down';
    }

    // Normalize locations to ensure they match the keys in locationStatuses
    const locations = rawLocations.map((loc) =>
      this.normalizeLegacyLocation(loc),
    );

    // If none of the configured locations exist in the actual results,
    // fall back to using the result locations directly. This handles
    // cases where monitor config has stale location codes that no longer
    // match any running worker (e.g., cloud locations after migration to local).
    const resultKeys = Object.keys(locationStatuses);
    const hasOverlap = locations.some((loc) => resultKeys.includes(loc));
    const effectiveLocations = hasOverlap ? locations : resultKeys;
    if (!hasOverlap && resultKeys.length > 0) {
      this.logger.warn(
        `Config locations [${locations.join(', ')}] don't match result locations [${resultKeys.join(', ')}]. Using result locations for aggregation.`,
      );
    }

    const upCount = effectiveLocations.filter(
      (loc) => locationStatuses[loc] === true,
    ).length;
    const totalCount = effectiveLocations.length;
    const upPercentage = (upCount / totalCount) * 100;
    const threshold =
      typeof config.threshold === 'number' ? config.threshold : 50;
    const anyUp = upCount > 0;

    this.logger.debug(
      `Aggregating status: ${upCount}/${totalCount} locations up (${upPercentage.toFixed(1)}%), strategy: ${config.strategy}`,
    );

    // Apply strategy (default to "majority" if not specified)
    const strategy = config.strategy || 'majority';
    switch (strategy) {
      case 'all':
        if (upCount === totalCount) {
          return 'up';
        }
        return anyUp ? 'partial' : 'down';
      case 'any':
        return upCount > 0 ? 'up' : 'down';
      case 'majority':
      default:
        if (upPercentage >= threshold) {
          return 'up';
        }
        return anyUp ? 'partial' : 'down';
    }
  }
}
