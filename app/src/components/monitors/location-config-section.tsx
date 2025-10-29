"use client";

import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin } from "lucide-react";
import {
  MONITORING_LOCATIONS,
  LOCATION_METADATA,
  DEFAULT_LOCATION_CONFIG,
} from "@/lib/location-service";
import type {
  LocationConfig,
  MonitoringLocation,
} from "@/lib/location-service";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryObject, Topology } from "topojson-specification";
import land110m from "world-atlas/land-110m.json";

const MAP_VIEWBOX_WIDTH = 960;
const MAP_VIEWBOX_HEIGHT = 520;
const MAP_PADDING = 28;

type ProjectedMarker = GlobeMarker & {
  x: number;
  y: number;
};

type LandFeature = FeatureCollection<Geometry, { name?: string }>;

const worldTopology = land110m as unknown as Topology & {
  objects: Record<string, GeometryObject | undefined>;
};

const landObject = worldTopology.objects.land;
const landFeature = landObject
  ? feature(worldTopology, landObject as GeometryObject)
  : null;

const LAND_FEATURE_COLLECTION: LandFeature =
  landFeature && landFeature.type === "FeatureCollection"
    ? (landFeature as LandFeature)
    : {
        type: "FeatureCollection",
        features: landFeature
          ? [landFeature as Feature<Geometry, { name?: string }>]
          : [],
      };

const MAP_PROJECTION = geoNaturalEarth1()
  .fitExtent(
    [
      [MAP_PADDING, MAP_PADDING],
      [MAP_VIEWBOX_WIDTH - MAP_PADDING, MAP_VIEWBOX_HEIGHT - MAP_PADDING],
    ],
    LAND_FEATURE_COLLECTION
  )
  .precision(0.1);

const PATH_GENERATOR = geoPath(MAP_PROJECTION);
const GRATICULE_PATH = PATH_GENERATOR(geoGraticule10()) ?? "";
const LAND_PATHS = LAND_FEATURE_COLLECTION.features
  .map((landFeature, index) => {
    const path = PATH_GENERATOR(landFeature);
    if (!path) {
      return null;
    }
    return {
      id: landFeature.id ?? landFeature.properties?.name ?? `land-${index}`,
      d: path,
    };
  })
  .filter(Boolean) as Array<{ id: string | number; d: string }>;

function projectLatLng(
  lat: number,
  lng: number
): { x: number; y: number } | null {
  const projected = MAP_PROJECTION([lng, lat]);
  if (!projected) {
    return null;
  }
  const [x, y] = projected;
  return { x, y };
}

interface LocationConfigSectionProps {
  value?: LocationConfig | null;
  onChange: (config: LocationConfig) => void;
  disabled?: boolean;
}

function LocationConfigSectionComponent({
  value,
  onChange,
  disabled = false,
}: LocationConfigSectionProps) {
  // Use value prop directly (fully controlled component)
  const config = value || DEFAULT_LOCATION_CONFIG;

  const handleEnabledChange = (enabled: boolean) => {
    const currentConfig = value || DEFAULT_LOCATION_CONFIG;
    const newConfig = { ...currentConfig, enabled };
    // If enabling and no locations selected, default to US East
    if (
      enabled &&
      (!currentConfig.locations || currentConfig.locations.length === 0)
    ) {
      newConfig.locations = [MONITORING_LOCATIONS.US_EAST];
    }
    onChange(newConfig);
  };

  const handleLocationToggle = (location: MonitoringLocation) => {
    const currentConfig = value || DEFAULT_LOCATION_CONFIG;
    const currentLocations = currentConfig.locations || [];
    const newLocations = currentLocations.includes(location)
      ? currentLocations.filter((l) => l !== location)
      : [...currentLocations, location];

    // Require at least one location when enabled
    if (newLocations.length === 0) {
      return;
    }

    const newConfig = { ...currentConfig, locations: newLocations };
    onChange(newConfig);
  };

  const handleStrategyChange = (
    strategy: "all" | "majority" | "any"
  ) => {
    const currentConfig = value || DEFAULT_LOCATION_CONFIG;
    const newConfig = { ...currentConfig, strategy };
    // Auto-adjust threshold based on strategy
    if (strategy === "all") {
      newConfig.threshold = 100;
    } else if (strategy === "majority") {
      newConfig.threshold = 50;
    } else if (strategy === "any") {
      newConfig.threshold = 1;
    }
    onChange(newConfig);
  };

  const selectedLocationCount = config.locations?.length || 0;
  const upRequired = Math.ceil(
    (selectedLocationCount * config.threshold) / 100
  );
  const selectedLocations = React.useMemo(
    () => config.locations || [],
    [config.locations]
  );

  return (
    <Card>
      <CardContent className="space-y-6">
        {/* Enable/Disable Multi-Location Monitoring */}
        <div
          className="flex items-center justify-between mt-6 cursor-pointer"
          onClick={() => !disabled && handleEnabledChange(!config.enabled)}
        >
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <label
                htmlFor="multi-location-enabled"
                className="font-medium cursor-pointer"
              >
                Multi-Location Monitoring
              </label>
            </div>
            <p className="text-sm text-muted-foreground">
              Monitor from multiple geographic locations for better reliability
              and global coverage
            </p>
          </div>
          <Switch
            id="multi-location-enabled"
            checked={config.enabled}
            onCheckedChange={handleEnabledChange}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          />
        </div>

        {config.enabled && (
          <div className="space-y-6">
            {/* Location Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">
                Select Locations ({selectedLocationCount} selected)
              </Label>
              <div className="flex flex-col gap-4 lg:flex-row">
                <div className="flex-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {Object.values(MONITORING_LOCATIONS).map((location) => {
                      const metadata = LOCATION_METADATA[location];
                      const isSelected =
                        config.locations?.includes(location) || false;

                      return (
                        <div
                          key={location}
                          className={cn(
                            "flex items-center space-x-2 rounded-lg border p-2 cursor-pointer transition-colors",
                            isSelected
                              ? "border-primary bg-primary/5 dark:bg-primary/10"
                              : "border-border hover:border-primary/50",
                            disabled && "opacity-50 cursor-not-allowed"
                          )}
                          onClick={() =>
                            !disabled && handleLocationToggle(location)
                          }
                        >
                          <Checkbox
                            className="h-3.5 w-3.5"
                            checked={isSelected}
                            onCheckedChange={() =>
                              !disabled && handleLocationToggle(location)
                            }
                            disabled={disabled}
                          />
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              {metadata.flag && (
                                <span className="text-base">
                                  {metadata.flag}
                                </span>
                              )}
                              <span className="font-medium text-sm">
                                {metadata.name}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Aggregation Strategy moved under selection cards */}
                  <div className="space-y-3 mt-8">
                    <Label className="text-sm font-medium">
                      Aggregation Strategy
                    </Label>
                    <Select
                      value={config.strategy || "majority"}
                      onValueChange={(value) =>
                        handleStrategyChange(
                          value as "all" | "majority" | "any"
                        )
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">
                          All Locations Up - Status is UP only if all locations
                          are up
                        </SelectItem>
                        <SelectItem value="majority">
                          Majority Up - Status is UP if more than 50% are up
                        </SelectItem>
                        <SelectItem value="any">
                          Any Location Up - Status is UP if at least one
                          location is up
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Summary moved here to reduce empty space */}
                  <div className="rounded-lg bg-muted/50 p-4 space-y-2 mt-8">
                    <h4 className="text-sm font-medium">
                      Configuration Summary
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>
                        • Monitoring from{" "}
                        <strong>{selectedLocationCount}</strong> location
                        {selectedLocationCount !== 1 ? "s" : ""}
                      </li>
                      <li>
                        • Status &quot;UP&quot; requires{" "}
                        <strong>
                          {upRequired}/{selectedLocationCount}
                        </strong>{" "}
                        locations reporting UP
                      </li>
                      <li>
                        • Each location check runs independently in parallel
                      </li>
                    </ul>
                  </div>
                </div>
                <LocationGlobe locations={selectedLocations} />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Memoize the component with deep comparison of value prop
export const LocationConfigSection = React.memo(
  LocationConfigSectionComponent,
  (prevProps, nextProps) => {
    // Only re-render if value actually changed (deep comparison)
    return (
      JSON.stringify(prevProps.value) === JSON.stringify(nextProps.value) &&
      prevProps.disabled === nextProps.disabled
    );
  }
);

type GlobeMarker = {
  code: MonitoringLocation;
  name: string;
  lat: number;
  lng: number;
  flag?: string;
};

function LocationGlobe({ locations }: { locations: MonitoringLocation[] }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [globeSize, setGlobeSize] = React.useState(400);

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const calculateSize = () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const { width } = container.getBoundingClientRect();
      if (!width) {
        return;
      }
      // Expand the globe to occupy available width while keeping bounds predictable
      const constrained = Math.min(Math.max(width, 320), 700);
      setGlobeSize(Math.floor(constrained));
    };

    calculateSize();
    window.addEventListener("resize", calculateSize);
    return () => window.removeEventListener("resize", calculateSize);
  }, []);

  const markers = React.useMemo(() => {
    return locations
      .map((location) => {
        const metadata = LOCATION_METADATA[location];
        if (!metadata?.coordinates) {
          return null;
        }
        return {
          code: location,
          name: metadata.name,
          lat: metadata.coordinates.lat,
          lng: metadata.coordinates.lon,
          flag: metadata.flag,
        };
      })
      .filter(Boolean) as GlobeMarker[];
  }, [locations]);

  const projectedMarkers = React.useMemo(() => {
    return markers
      .map((marker) => {
        const projection = projectLatLng(marker.lat, marker.lng);
        if (!projection) {
          return null;
        }
        return {
          ...marker,
          ...projection,
        };
      })
      .filter(Boolean) as ProjectedMarker[];
  }, [markers]);

  return (
    <div className="w-full max-w-[620px] min-h-[420px] rounded-2xl border border-border/60 bg-muted/30 px-6 py-6 shadow-md">
      <div className="flex items-center justify-between gap-6">
        <span className="text-base font-semibold tracking-tight">
          Global Coverage Preview
        </span>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {markers.length} selected
        </span>
      </div>
      <div
        ref={containerRef}
        className="mt-6 flex flex-col items-center flex-1"
      >
        <div className="flex w-full max-w-[560px] items-center justify-center">
          <SimpleGlobe size={globeSize} markers={projectedMarkers} />
        </div>
        {markers.length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground text-center">
            Select a location to visualise its global placement.
          </p>
        )}
      </div>
    </div>
  );
}

function SimpleGlobe({
  size,
  markers,
}: {
  size: number;
  markers: ProjectedMarker[];
}) {
  const boundedWidth = Math.max(360, Math.min(size, 760));
  const aspectRatio = MAP_VIEWBOX_WIDTH / MAP_VIEWBOX_HEIGHT;
  const svgWidth = boundedWidth;
  const svgHeight = Math.round(boundedWidth / aspectRatio);

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${MAP_VIEWBOX_WIDTH} ${MAP_VIEWBOX_HEIGHT}`}
      className="rounded-xl border border-border/60 bg-[radial-gradient(circle_at_20%_20%,rgba(30,64,175,0.25),rgba(15,23,42,0.9))] shadow-[0_18px_40px_rgba(15,23,42,0.45)]"
      role="img"
      aria-label="Selected monitoring locations on a world map"
    >
      <defs>
        <linearGradient id="mapOcean" x1="0%" x2="100%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(15,23,42,0.92)" />
          <stop offset="70%" stopColor="rgba(30,41,59,0.92)" />
          <stop offset="100%" stopColor="rgba(15,23,42,1)" />
        </linearGradient>
        <linearGradient id="mapLand" x1="0%" x2="100%" y1="0%" y2="0%">
          <stop offset="0%" stopColor="rgba(96,165,250,0.45)" />
          <stop offset="55%" stopColor="rgba(148,163,184,0.65)" />
          <stop offset="100%" stopColor="rgba(191,219,254,0.5)" />
        </linearGradient>
        <filter id="landShadow" x="-5%" y="-5%" width="110%" height="110%">
          <feDropShadow
            dx="0"
            dy="2"
            stdDeviation="3"
            floodColor="rgba(12,25,45,0.55)"
          />
        </filter>
      </defs>

      <rect
        width={MAP_VIEWBOX_WIDTH}
        height={MAP_VIEWBOX_HEIGHT}
        fill="url(#mapOcean)"
        rx="18"
      />

      {GRATICULE_PATH ? (
        <path
          d={GRATICULE_PATH}
          fill="none"
          stroke="rgba(148,163,184,0.25)"
          strokeWidth="0.6"
        />
      ) : null}

      <g filter="url(#landShadow)">
        {LAND_PATHS.map((land) => (
          <path
            key={land.id}
            d={land.d}
            fill="url(#mapLand)"
            stroke="rgba(226,232,240,0.28)"
            strokeWidth="0.8"
          />
        ))}
      </g>

      {markers.map((marker) => {
        const isRightHalf = marker.x >= MAP_VIEWBOX_WIDTH / 2;
        const labelOffsetX = isRightHalf ? -10 : 10;
        const anchor = isRightHalf ? "end" : "start";

        return (
          <g key={marker.code}>
            <circle
              cx={marker.x}
              cy={marker.y}
              r={7}
              fill="rgba(16,185,129,0.92)"
              stroke="rgba(15,23,42,0.95)"
              strokeWidth="1.8"
            />
            <text
              x={marker.x + labelOffsetX}
              y={marker.y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize="15"
              fontWeight={700}
              fill="rgba(226,232,240,0.95)"
            >
              {marker.flag ? `${marker.flag} ` : ""}
              {marker.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Helper function for cn utility (if not already in your utils)
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
