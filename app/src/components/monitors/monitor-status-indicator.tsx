"use client";

import * as React from "react";

import { 
  CheckCircle, 
  XCircle, 
  Pause, 
  Clock, 
  AlertCircle,
  PlayCircle 
} from "lucide-react";

interface MonitorStatusIndicatorProps {
  monitorId: string;
  status: string;
  uptime?: number;
}

const getStatusConfig = (status: string) => {
  switch (status.toLowerCase()) {
    case "up":
      return {
        label: "Up",
        variant: "default" as const,
        icon: CheckCircle,
        color: "text-green-500",
      };
    case "down":
      return {
        label: "Down",
        variant: "destructive" as const,
        icon: XCircle,
        color: "text-red-500",
      };
    case "paused":
      return {
        label: "Paused",
        variant: "secondary" as const,
        icon: Pause,
        color: "text-gray-500",
      };
    case "pending":
      return {
        label: "Pending",
        variant: "outline" as const,
        icon: Clock,
        color: "text-gray-500",
      };
    case "running":
      return {
        label: "Running",
        variant: "outline" as const,
        icon: PlayCircle,
        color: "text-blue-500",
      };
    case "error":
      return {
        label: "Error",
        variant: "destructive" as const,
        icon: AlertCircle,
        color: "text-orange-500",
      };
    default:
      return {
        label: "Unknown",
        variant: "outline" as const,
        icon: Clock,
        color: "text-gray-500",
      };
  }
};

export function MonitorStatusIndicator({ status }: MonitorStatusIndicatorProps) {
  const statusConfig = getStatusConfig(status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="flex items-center">
      <StatusIcon className={`h-4 w-4 mr-2 ${statusConfig.color}`} />
      <span>{statusConfig.label}</span>
    </div>
  );
} 