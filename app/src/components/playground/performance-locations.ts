"use client";

export type PerformanceLocation = string | "global";

export type PerformanceLocationOption = {
  value: PerformanceLocation;
  name: string;
  region: string;
  flag?: string;
};

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
  options: PerformanceLocationOption[]
): PerformanceLocationOption | undefined {
  return options.find((option) => option.value === value);
}
