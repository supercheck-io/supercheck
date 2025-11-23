"use client";

import {
  MONITORING_LOCATIONS,
  LOCATION_METADATA,
  type MonitoringLocation,
} from "@/lib/location-service";

export type PerformanceLocation = MonitoringLocation | "GLOBAL";

export const PERFORMANCE_LOCATIONS: MonitoringLocation[] = [
  MONITORING_LOCATIONS.US,
  MONITORING_LOCATIONS.EU,
  MONITORING_LOCATIONS.APAC,
];

export type PerformanceLocationOption = {
  value: PerformanceLocation;
  name: string;
  region: string;
  flag?: string;
};

export const PERFORMANCE_LOCATION_OPTIONS: PerformanceLocationOption[] = [
  {
    value: "GLOBAL",
    name: "Global",
    region: "Global",
    flag: "🌍",
  },
  ...PERFORMANCE_LOCATIONS.map((location) => {
    const metadata = LOCATION_METADATA[location];
    return {
      value: location,
      name: metadata?.name ?? location,
      region: metadata?.region ?? "",
      flag: metadata?.flag,
    };
  }),
];

export function getPerformanceLocationOption(
  value: PerformanceLocation
): PerformanceLocationOption | undefined {
  return PERFORMANCE_LOCATION_OPTIONS.find(
    (option) => option.value === value
  );
}
