"use client";

import * as React from "react";

import {
  AlertCircle,
  CheckCircle,
  Clock,
  Pause,
  PlayCircle,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";

interface MonitorStatusIndicatorProps {
  monitorId: string;
  status: string;
  uptime?: number;
}

type StatusConfig = { label: string; icon: LucideIcon; tone: TableBadgeTone };

const STATUS_CONFIG: Record<string, StatusConfig> = {
  up: { label: "Up", icon: CheckCircle, tone: "success" },
  down: { label: "Down", icon: XCircle, tone: "danger" },
  paused: { label: "Paused", icon: Pause, tone: "slate" },
  pending: { label: "Pending", icon: Clock, tone: "neutral" },
  running: { label: "Running", icon: PlayCircle, tone: "info" },
  maintenance: { label: "Maintenance", icon: Wrench, tone: "purple" },
  error: { label: "Error", icon: AlertCircle, tone: "warning" },
};

const UNKNOWN: StatusConfig = { label: "Unknown", icon: Clock, tone: "neutral" };

export function getMonitorStatusConfig(status: string): StatusConfig {
  const key = status.toLowerCase();
  return Object.hasOwn(STATUS_CONFIG, key) ? STATUS_CONFIG[key] : UNKNOWN;
}

/** A tinted pill, the same badge style as the tests and services tables. */
export function MonitorStatusIndicator({ status }: MonitorStatusIndicatorProps) {
  const { label, icon: StatusIcon, tone } = getMonitorStatusConfig(status);

  return (
    <TableBadge tone={tone} compact className="gap-1 whitespace-nowrap">
      <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
      {label}
    </TableBadge>
  );
}
