import {
  CheckCircle,
  AlertCircle,
  PlayCircle,
  XCircle,
  Workflow,
  Timer,
  MousePointerClick,
  ShieldOff,
  Clock,
  Ban,
} from "lucide-react";

export const runStatuses = [
  {
    value: "queued",
    label: "Queued",
    icon: Clock,
    color: "text-muted-foreground",
  },
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
    color: "text-success",
  },
  {
    value: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-failure",
  },
  {
    value: "error",
    label: "Error",
    icon: AlertCircle,
    color: "text-warning",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    icon: Ban,
    color: "text-muted-foreground",
  },
  {
    value: "blocked",
    label: "Blocked",
    icon: ShieldOff,
    color: "text-failure",
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
