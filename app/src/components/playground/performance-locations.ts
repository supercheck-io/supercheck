"use client";

import {
  LOCATION_METADATA,
  type MonitoringLocation,
} from "@/lib/location-service";

export type PerformanceLocation = string | "global";

export type PerformanceLocationOption = {
  value: PerformanceLocation;
  name: string;
  region: string;
  flag?: string;
};

/** @deprecated Static fallback; prefer `buildPerformanceLocationOptions()` with dynamic data. */
export const PERFORMANCE_LOCATIONS: MonitoringLocation[] = ["local"];

/** @deprecated Static fallback; prefer `buildPerformanceLocationOptions()` with dynamic data. */
export const PERFORMANCE_LOCATION_OPTIONS: PerformanceLocationOption[] =
  buildPerformanceLocationOptions(
    PERFORMANCE_LOCATIONS.map((code) => {
      const meta = LOCATION_METADATA[code];
      return {
        code,
        name: meta?.name ?? code,
        region: meta?.region ?? null,
        flag: meta?.flag ?? null,
      };
    })
  );

/**
 * Build the full list of performance location options (Global + per-location)
 * from dynamic location data. Call this with data from the `useLocations()` hook.
 */
export function buildPerformanceLocationOptions(
  locations: Array<{
    code: string;
    name: string;
    region: string | null;
    flag: string | null;
  }>,
  options: {
    includeGlobal?: boolean;
  } = {}
): PerformanceLocationOption[] {
  const includeGlobal = options.includeGlobal ?? true;

  return [
    ...(includeGlobal
      ? [{ value: "global", name: "Global", region: "Global", flag: "🌍" }]
      : []),
    ...locations.map((loc) => ({
      value: loc.code,
      name: loc.name,
      region: loc.region ?? "",
      flag: loc.flag ?? undefined,
    })),
  ];
}

export function getPerformanceLocationOption(
  value: PerformanceLocation,
  options: PerformanceLocationOption[] = PERFORMANCE_LOCATION_OPTIONS
): PerformanceLocationOption | undefined {
  return options.find((option) => option.value === value);
}
