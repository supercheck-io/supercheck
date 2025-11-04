"use client";

import {
  MONITORING_LOCATIONS,
  LOCATION_METADATA,
  type MonitoringLocation,
} from "@/lib/location-service";

export type PerformanceLocation = MonitoringLocation;

export const PERFORMANCE_LOCATIONS: PerformanceLocation[] = [
  MONITORING_LOCATIONS.US_EAST,
  MONITORING_LOCATIONS.EU_CENTRAL,
  MONITORING_LOCATIONS.ASIA_PACIFIC,
];

export type PerformanceLocationOption = {
  value: PerformanceLocation;
  name: string;
  region: string;
  flag?: string;
};

export const PERFORMANCE_LOCATION_OPTIONS: PerformanceLocationOption[] =
  PERFORMANCE_LOCATIONS.map((location) => {
    const metadata = LOCATION_METADATA[location];
    return {
      value: location,
      name: metadata?.name ?? location,
      region: metadata?.region ?? "",
      flag: metadata?.flag,
    };
  });

export function getPerformanceLocationOption(
  value: PerformanceLocation
): PerformanceLocationOption | undefined {
  return PERFORMANCE_LOCATION_OPTIONS.find(
    (option) => option.value === value
  );
}
