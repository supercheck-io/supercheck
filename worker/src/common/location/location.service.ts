import { Injectable, Logger } from '@nestjs/common';

/** Location codes are dynamic strings from the locations DB table. */
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
   * Get display name for a location.
   * Returns the location code as-is since display names come from the DB.
   */
  getLocationDisplayName(location: string): string {
    return location;
  }

  /**
   * Get the effective locations for a monitor (handles legacy and multi-location configs).
   */
  getEffectiveLocations(config?: LocationConfig | null): string[] {
    if (!config || !config.enabled) {
      // Single location mode - use default primary location
      return ['local'];
    }

    return config.locations || ['local'];
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

    // Use location codes as-is (dynamic locations, no legacy normalization needed)
    const locations = rawLocations;

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
