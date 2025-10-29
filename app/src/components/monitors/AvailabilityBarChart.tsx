"use client";

import * as React from "react";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";

interface AvailabilityDataPoint {
  timestamp: number;
  status: 0 | 1; // 0 for down, 1 for up
  label?: string;
  locationCode?: string | null;
  locationName?: string | null;
  locationFlag?: string | null;
}

interface AvailabilityBarChartProps {
  data: AvailabilityDataPoint[];
  headerActions?: React.ReactNode;
}

type ProcessedAvailabilityPoint = {
  name: string;
  status: "up" | "down";
  fill: string;
  value: number;
  locationCode: string | null;
  locationName: string | null;
  locationFlag: string | null;
  timestamp: number;
  formattedDate: string;
};

type ChartMouseState = {
  isTooltipActive?: boolean;
  activePayload?: Array<{ payload?: ProcessedAvailabilityPoint } | undefined>;
  activeCoordinate?: { x: number; y: number };
  chartX?: number;
  chartY?: number;
};

const chartConfig = {
  up: {
    label: "Up",
    color: "#22c55e", // Explicit green color (Tailwind's green-500)
  },
  down: {
    label: "Down",
    color: "#ef4444", // Explicit red color (Tailwind's red-500)
  },
};

export function AvailabilityBarChart({
  data,
  headerActions,
}: AvailabilityBarChartProps) {
  const [tooltipState, setTooltipState] = React.useState<{
    left: number;
    top: number;
    payload: ProcessedAvailabilityPoint;
  } | null>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);
  const [visibleBars, setVisibleBars] = React.useState(0);

  React.useEffect(() => {
    if (!data || data.length === 0) return;

    let currentBar = 0;
    const interval = setInterval(() => {
      currentBar++;
      setVisibleBars(currentBar);

      if (currentBar >= data.length) {
        clearInterval(interval);
      }
    }, 20); // 20ms delay between each bar

    return () => clearInterval(interval);
  }, [data]);

  const handleMouseMove = React.useCallback((state: ChartMouseState) => {
    if (!chartRef.current) {
      return;
    }

    const activePayload = state?.activePayload?.[0]?.payload as
      | ProcessedAvailabilityPoint
      | undefined;
    const activeCoordinate = state?.activeCoordinate;

    if (!activePayload || !activeCoordinate) {
      setTooltipState(null);
      return;
    }

    const left = activeCoordinate.x ?? state?.chartX ?? 0;
    const top = (activeCoordinate.y ?? state?.chartY ?? 0) + 12;

    setTooltipState({
      left,
      top,
      payload: activePayload,
    });
  }, []);

  if (!data || data.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">
            Availability Overview
          </CardTitle>
          <CardDescription className="text-sm">
            Availability status for monitor checks.
          </CardDescription>
        </CardHeader>
        <CardContent
          className="p-4 pt-2"
          style={{
            height: "120px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className="text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
              <svg
                className="w-6 h-6 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <p className="text-muted-foreground text-sm font-medium">
                No Availability Data
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Availability status will appear here after the first check.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const processedData: ProcessedAvailabilityPoint[] = data
    .slice(0, visibleBars)
    .map((item, index) => {
      const timestamp = item.timestamp;
      const formattedDate = Number.isFinite(timestamp)
        ? format(new Date(timestamp), "MMM dd, HH:mm")
        : "";
      return {
        name: `Run ${index + 1}`,
        status: item.status === 1 ? "up" : "down",
        fill: item.status === 1 ? chartConfig.up.color : chartConfig.down.color,
        value: 1,
        locationCode: item.locationCode ?? null,
        locationName: item.locationName ?? null,
        locationFlag: item.locationFlag ?? null,
        timestamp,
        formattedDate,
      };
    });

  const getDescription = () => {
    return `Status of latest individual checks (${data.length} data points)`;
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-lg font-semibold mb-2">
            Availability Overview
          </CardTitle>
          <CardDescription>{getDescription()}</CardDescription>
        </div>
        {headerActions ? (
          <div className="flex-shrink-0">{headerActions}</div>
        ) : null}
      </CardHeader>
      <CardContent className="relative p-3 h-[120px]">
        <div
          className="relative h-full w-full"
          ref={chartRef}
          onMouseLeave={() => setTooltipState(null)}
        >
          <ChartContainer config={chartConfig} className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={processedData}
                margin={{
                  top: 5,
                  right: 5,
                  left: 5,
                  bottom: 5,
                }}
                barSize={Math.max(
                  8,
                  Math.min(20, Math.floor(800 / data.length))
                )}
                barCategoryGap="2%"
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setTooltipState(null)}
              >
                <CartesianGrid
                  vertical={false}
                  horizontal={false}
                  strokeDasharray="3 3"
                />
                <XAxis dataKey="name" type="category" hide />
                <YAxis type="number" hide />
                <Tooltip
                  cursor={false}
                  content={() => null}
                  allowEscapeViewBox={{ x: true, y: true }}
                />
                <Bar dataKey="value" radius={1}>
                  {processedData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={entry.fill}
                      style={{
                        transition: "fill 0.2s ease",
                      }}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
          {tooltipState ? (
            <div
              className="pointer-events-none absolute z-20 -translate-x-1/2"
              style={{
                left: Math.min(
                  Math.max(tooltipState.left, 20),
                  (chartRef.current?.clientWidth ?? 0) - 20
                ),
                top: Math.min(
                  Math.max(tooltipState.top, 12),
                  (chartRef.current?.clientHeight ?? 0) - 12
                ),
              }}
            >
              <div className="min-w-[200px] max-w-[260px] rounded-lg border border-border bg-background/95 p-3 text-sm shadow-xl backdrop-blur">
                <p className="mb-2 text-center font-medium text-foreground">
                  {tooltipState.payload.formattedDate ||
                    format(
                      new Date(tooltipState.payload.timestamp),
                      "MMM dd, HH:mm"
                    )}
                </p>
                <div className="space-y-1">
                  {(tooltipState.payload.locationName ||
                    tooltipState.payload.locationCode) && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Location:</span>
                      <span className="ml-3 font-medium text-right text-foreground">
                        {tooltipState.payload.locationFlag
                          ? `${tooltipState.payload.locationFlag} `
                          : ""}
                        {tooltipState.payload.locationName ||
                          tooltipState.payload.locationCode ||
                          "Check"}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <div className="ml-3 flex items-center">
                      <span
                        className={`mr-2 inline-flex h-2 w-2 rounded-full ${
                          tooltipState.payload.status === "up"
                            ? "bg-green-500"
                            : "bg-red-500"
                        }`}
                      />
                      <span
                        className={`font-medium ${
                          tooltipState.payload.status === "up"
                            ? "text-green-500"
                            : "text-red-500"
                        }`}
                      >
                        {tooltipState.payload.status === "up" ? "Up" : "Down"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
