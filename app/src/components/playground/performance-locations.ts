"use client";

export type PerformanceLocation = string | "global";

export type PerformanceLocationOption = {
  value: PerformanceLocation;
  name: string;
  region: string;
  flag?: string;
  /** True when the location cannot run k6; shown but not selectable. */
  disabled?: boolean;
  disabledReason?: string;
};

export const K6_UNAVAILABLE_REASON =
  "Performance tests are not available in this region.";

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
    supportsK6?: boolean;
  }>,
  options: {
    includeGlobal?: boolean;
  } = {}
): PerformanceLocationOption[] {
  // "global" runs on any eligible k6 worker, so offer it only when some location can run k6.
  const anyK6Capable = locations.length === 0 || locations.some((loc) => loc.supportsK6 !== false);
  const includeGlobal = (options.includeGlobal ?? true) && anyK6Capable;

  return [
    ...(includeGlobal
      ? [{ value: "global", name: "Global", region: "Global", flag: "🌍" }]
      : []),
    ...locations.map((loc) => ({
      value: loc.code,
      name: loc.name,
      region: loc.region ?? "",
      flag: loc.flag ?? undefined,
      ...(loc.supportsK6 === false
        ? { disabled: true, disabledReason: K6_UNAVAILABLE_REASON }
        : {}),
    })),
  ];
}

export function getPerformanceLocationOption(
  value: PerformanceLocation,
  options: PerformanceLocationOption[]
): PerformanceLocationOption | undefined {
  return options.find((option) => option.value === value);
}
