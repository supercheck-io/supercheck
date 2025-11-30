import {
  CheckCircle,
  AlertCircle,
  PlayCircle,
  XCircle,
  Workflow,
  Timer,
  MousePointerClick,
  Ban,
  ShieldOff,
} from "lucide-react";

export const runStatuses = [
  {
    value: "running",
    label: "Running",
    icon: PlayCircle,
    color: "text-blue-500",
  },
  {
    value: "passed",
    label: "Passed",
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    value: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-red-500",
  },
  {
    value: "error",
    label: "Error",
    icon: AlertCircle,
    color: "text-orange-500",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    icon: Ban,
    color: "text-orange-500",
  },
  {
    value: "blocked",
    label: "Blocked",
    icon: ShieldOff,
    color: "text-red-600",
  },
];

export const triggerTypes = [
  {
    value: "manual",
    label: "Manual",
    icon: MousePointerClick,
    color: "text-blue-500",
  },
  {
    value: "remote",
    label: "Remote",
    icon: Workflow,
    color: "text-cyan-500",
  },
  {
    value: "schedule",
    label: "Schedule",
    icon: Timer,
    color: "text-sky-500",
  },
];
