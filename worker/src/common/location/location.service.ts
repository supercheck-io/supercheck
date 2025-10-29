import { Injectable, Logger } from '@nestjs/common';

/**
 * Available monitoring locations for multi-location monitoring.
 */
export const MONITORING_LOCATIONS = {
  US_EAST: 'us-east',
  EU_CENTRAL: 'eu-central',
  ASIA_PACIFIC: 'asia-pacific',
} as const;

export type MonitoringLocation =
  (typeof MONITORING_LOCATIONS)[keyof typeof MONITORING_LOCATIONS];

/**
 * Location metadata including display name and geographic information.
 */
export type LocationMetadata = {
  code: MonitoringLocation;
  name: string;
  region: string;
  coordinates?: { lat: number; lon: number };
};

/**
 * Configuration for multi-location monitoring.
 */
export type LocationConfig = {
  enabled: boolean;
  locations: MonitoringLocation[];
  threshold: number;
  strategy?: 'all' | 'majority' | 'any';
};

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);

  /**
   * Location metadata for all available monitoring locations.
   */
  private readonly locationMetadata: Record<
    MonitoringLocation,
    LocationMetadata
  > = {
    [MONITORING_LOCATIONS.US_EAST]: {
      code: MONITORING_LOCATIONS.US_EAST,
      name: 'US East',
      region: 'N. Virginia',
      coordinates: { lat: 38.9072, lon: -77.0369 },
    },
    [MONITORING_LOCATIONS.EU_CENTRAL]: {
      code: MONITORING_LOCATIONS.EU_CENTRAL,
      name: 'EU Central',
      region: 'Frankfurt',
      coordinates: { lat: 50.1109, lon: 8.6821 },
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
    location: MonitoringLocation,
  ): LocationMetadata | undefined {
    return this.locationMetadata[location];
  }

  /**
   * Get display name for a location.
   */
  getLocationDisplayName(location: MonitoringLocation): string {
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
  getEffectiveLocations(config?: LocationConfig | null): MonitoringLocation[] {
    if (!config || !config.enabled) {
      // Single location mode - use default primary location
      return [MONITORING_LOCATIONS.US_EAST];
    }

    return config.locations || [MONITORING_LOCATIONS.US_EAST];
  }

  /**
   * Calculate the overall status based on location results and threshold.
   */
  calculateAggregatedStatus(
    locationStatuses: Record<MonitoringLocation, boolean>,
    config: LocationConfig,
  ): 'up' | 'down' | 'partial' {
    const locations = config.locations || [];
    if (locations.length === 0) {
      return 'down';
    }

    const upCount = locations.filter(
      (loc) => locationStatuses[loc] === true,
    ).length;
    const totalCount = locations.length;
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
