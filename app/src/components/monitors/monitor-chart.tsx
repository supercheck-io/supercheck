"use client";

import * as React from "react";
import { Bar, BarChart, CartesianGrid, XAxis, ResponsiveContainer, Tooltip, LineChart, Line, YAxis, AreaChart, Area } from "recharts";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Define the structure for data points passed to the chart
export interface MonitorChartDataPoint {
    timestamp: number; // Milliseconds timestamp for X-axis
    status: number;    // 0 for down/error, 1 for up
    label?: string;     // e.g., 'up', 'down', 'error'
    responseTime?: number | null;
    // Add other relevant fields from MonitorResultItem if needed for tooltips
}

interface MonitorChartProps {
  data?: MonitorChartDataPoint[]; // Data is now optional, falls back to generated if not provided
  chartType?: "bar" | "line" | "step" | "area"; // Optional chart type
  // monitorId?: string; // Kept if there's a use case for fetching within component later
  // uptime?: number; // These can be derived from data or passed for summary display
  // responseTime?: number;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    payload: MonitorChartDataPoint;
  }>;
  label?: string;
}

// Default data generation if no data is provided via props
const generateDefaultChartData = (days = 14) => {
  const data: MonitorChartDataPoint[] = [];
  const now = new Date();
  let successRate = 92; 
  let responseTimeVal = 342; 
  
  for (let i = days; i >= 0; i--) {
    const date = new Date();
    date.setDate(now.getDate() - i);
    
    const randomChange = Math.random() * 10 - 5; 
    successRate = Math.min(100, Math.max(70, successRate + randomChange));
    responseTimeVal = Math.max(300, Math.min(400, responseTimeVal + (Math.random() * 40 - 20)));
    
    const isUp = Math.random() > (1 - successRate/100); // Simulate up/down based on successRate

    data.push({
      timestamp: date.getTime(),
      status: isUp ? 1 : 0,
      label: isUp ? 'up' : 'down',
      responseTime: Math.round(responseTimeVal)
    });
  }
  return data;
};

const CustomTooltip = ({ active, payload }: TooltipProps) => {
  if (active && payload && payload.length) {
    const dataPoint = payload[0].payload as MonitorChartDataPoint;
    const date = new Date(dataPoint.timestamp);
    const formattedDate = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric"
    });
    
    return (
      <div className="bg-background border rounded-md p-2 shadow-sm text-xs">
        <p className="font-medium mb-1">{formattedDate}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex items-center">
            <div className={`w-2 h-2 ${dataPoint.status === 1 ? 'bg-green-500' : 'bg-red-500'} rounded-full mr-1`}></div>
            <span className="text-muted-foreground">Status:</span>
          </div>
          <span>{dataPoint.label || (dataPoint.status === 1 ? 'Up' : 'Down')}</span>
          
          {dataPoint.responseTime !== undefined && dataPoint.responseTime !== null && (
            <>
                <div className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-1"></div>
                    <span className="text-muted-foreground">Response:</span>
                </div>
                <span>{dataPoint.responseTime} ms</span>
            </>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export function MonitorChart({ 
    data: providedData,
    chartType = "line", // Default to line chart
}: MonitorChartProps) {
  
  const chartData = React.useMemo(() => providedData && providedData.length > 0 ? providedData : generateDefaultChartData(), [providedData]);
  // const [activeTab, setActiveTab] = React.useState<"uptime" | "response">("uptime"); // This tab logic seems specific to old data structure

  // Determine which dataKey to use for the Y-axis based on chart content.
  // For status, we use the 'status' field (0 or 1).
  const yDataKey = "status"; 

  const renderChart = () => {
    switch(chartType) {
        case "bar":
            return (
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false}/>
                    <XAxis dataKey="timestamp" tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} angle={-30} textAnchor="end" height={40} />
                    <YAxis domain={[0, 1]} tickFormatter={(value) => value === 1 ? 'Up' : 'Down'} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey={yDataKey} fill="rgba(34, 197, 94, 0.8)" radius={[4, 4, 0, 0]} />
                </BarChart>
            );
        case "area":
            return (
                <AreaChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false}/>
                    <XAxis dataKey="timestamp" tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} angle={-30} textAnchor="end" height={40} />
                    <YAxis domain={[0, 1]} tickFormatter={(value) => value === 1 ? 'Up' : 'Down'} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey={yDataKey} stroke="#22c55e" fill="rgba(34, 197, 94, 0.3)" />
                </AreaChart>
            );
        case "step": // Recharts doesn't have a dedicated "step" type for Line, use Line with type="step"
        case "line":
        default:
            return (
                <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} vertical={false}/>
                    <XAxis dataKey="timestamp" tickFormatter={(unixTime) => new Date(unixTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} angle={-30} textAnchor="end" height={40} />
                    <YAxis domain={[0, 1]} tickFormatter={(value) => value === 1 ? 'Up' : 'Down'} />
                    <Tooltip content={<CustomTooltip />} />
                    <Line type={chartType === "step" ? "stepAfter" : "monotone"} dataKey={yDataKey} stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
            );
    }
  }

  return (
    <Card>
      {/* Header can be simplified if title is managed by parent */}
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-medium">Status Over Time ({chartType})</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {chartData.length > 0 ? (
            <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    {renderChart()}
                </ResponsiveContainer>
            </div>
        ) : (
            <div className="h-[240px] w-full flex items-center justify-center">
                <p className="text-muted-foreground">No data to display chart.</p>
            </div>
        )}
      </CardContent>
    </Card>
  );
} 