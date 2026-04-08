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
   *
   * When location config is disabled or absent, returns the worker's own location
   * (from WORKER_LOCATION env var, defaulting to 'local'). This avoids hardcoding
   * "local" which is not valid for cloud deployments.
   */
  getEffectiveLocations(config?: LocationConfig | null): string[] {
    if (!config || !config.enabled) {
      // Use the worker's actual location instead of hardcoding 'local'
      const workerLocation =
        process.env.WORKER_LOCATION?.toLowerCase() || 'local';
      return [workerLocation];
    }

    if (!config.locations || config.locations.length === 0) {
      const workerLocation =
        process.env.WORKER_LOCATION?.toLowerCase() || 'local';
      return [workerLocation];
    }

    return config.locations;
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

    // Only aggregate over locations that actually have results.
    // When some locations are disabled (no workers), their results won't exist
    // and they should not count as "down" in the aggregation.
    const resultKeys = Object.keys(locationStatuses);
    const effectiveLocations = resultKeys.length > 0 ? resultKeys : locations;
    if (resultKeys.length > 0 && resultKeys.length < locations.length) {
      this.logger.debug(
        `Aggregating over ${resultKeys.length}/${locations.length} locations with results: [${resultKeys.join(', ')}]. ` +
          `Locations without results (disabled/offline): [${locations.filter((l) => !resultKeys.includes(l)).join(', ')}].`,
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
