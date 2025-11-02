"use client";

import React from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryObject, Topology } from "topojson-specification";
import land110m from "world-atlas/land-110m.json";
import { cn } from "@/lib/utils";
import {
  LOCATION_METADATA,
  type MonitoringLocation,
} from "@/lib/location-service";

const MAP_VIEWBOX_WIDTH = 960;
const MAP_VIEWBOX_HEIGHT = 520;
const MAP_PADDING = 28;

type GlobeMarker = {
  code: MonitoringLocation;
  name: string;
  lat: number;
  lng: number;
  flag?: string;
};

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

export interface LocationMapCardProps {
  locations: MonitoringLocation[];
  title?: string;
  badgeContent?: React.ReactNode;
  emptyMessage?: string;
  className?: string;
  size?: "default" | "compact";
  children?: React.ReactNode;
}

export function LocationMapCard({
  locations,
  title = "Global Coverage Preview",
  badgeContent,
  emptyMessage = "Select a location to visualise its global placement.",
  className,
  size = "default",
  children,
}: LocationMapCardProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [globeSize, setGlobeSize] = React.useState(
    size === "compact" ? 320 : 400
  );

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
      const minWidth = size === "compact" ? 280 : 320;
      const maxWidth = size === "compact" ? 560 : 700;
      const constrained = Math.min(Math.max(width, minWidth), maxWidth);
      setGlobeSize(Math.floor(constrained));
    };

    calculateSize();
    window.addEventListener("resize", calculateSize);
    return () => window.removeEventListener("resize", calculateSize);
  }, [size]);

  const markers = locations
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
      } as GlobeMarker;
    })
    .filter((marker): marker is GlobeMarker => marker !== null);

  const projectedMarkers = markers
    .map((marker) => {
      const projection = projectLatLng(marker.lat, marker.lng);
      if (!projection) {
        return null;
      }
      return {
        ...marker,
        ...projection,
      } as ProjectedMarker;
    })
    .filter((marker): marker is ProjectedMarker => marker !== null);

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-border/60 bg-muted/30 px-6 py-6",
        size === "compact" ? "min-h-[360px]" : "min-h-[420px]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-6">
        <span className="text-base font-semibold tracking-tight">{title}</span>
        {badgeContent ? (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {badgeContent}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {markers.length} selected
          </span>
        )}
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
            {emptyMessage}
          </p>
        )}
        {markers.length > 0 && children ? (
          <div className="mt-6 w-full">{children}</div>
        ) : null}
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
  const minWidth = 320;
  const maxWidth = 760;
  const boundedWidth = Math.max(minWidth, Math.min(size, maxWidth));
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
            dy="8"
            stdDeviation="12"
            floodColor="rgba(15,23,42,0.45)"
          />
        </filter>
      </defs>

      <rect
        width={MAP_VIEWBOX_WIDTH}
        height={MAP_VIEWBOX_HEIGHT}
        fill="url(#mapOcean)"
        rx="24"
      />

      <path
        d={GRATICULE_PATH}
        fill="none"
        stroke="rgba(148,163,184,0.15)"
        strokeWidth={1.2}
      />

      <g filter="url(#landShadow)">
        {LAND_PATHS.map((land) => (
          <path
            key={land.id}
            d={land.d}
            fill="url(#mapLand)"
            stroke="rgba(148,163,184,0.4)"
            strokeWidth={0.6}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.9}
          />
        ))}
      </g>

      {markers.map((marker) => {
        const isRightHalf = marker.x >= MAP_VIEWBOX_WIDTH / 2;
        const labelOffsetX = isRightHalf ? -14 : 14;
        const textAnchor = isRightHalf ? "end" : "start";

        return (
          <g key={marker.code}>
            <circle
              cx={marker.x}
              cy={marker.y}
              r={12}
              fill="rgba(59,130,246,0.32)"
              stroke="rgba(96,165,250,0.95)"
              strokeWidth={2}
            />
            <circle cx={marker.x} cy={marker.y} r={5} fill="rgba(125,211,252,1)" />
            {marker.flag && (
              <text
                x={marker.x + labelOffsetX}
                y={marker.y - 22}
                textAnchor={textAnchor}
                fontSize={22}
                fontWeight={600}
                fill="rgba(226,232,240,0.98)"
              >
                {marker.flag}
              </text>
            )}
            <text
              x={marker.x + labelOffsetX}
              y={marker.y - 2}
              textAnchor={textAnchor}
              fontSize={16}
              fontWeight={700}
              fill="rgba(226,232,240,0.98)"
            >
              {marker.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
