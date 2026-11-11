import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle,
  Clock,
  PlayCircle,
  XCircle,
  AlertCircle,
  ShieldOff,
} from "lucide-react"

export const jobStatuses = [
  {
    value: "pending",
    label: "Pending",
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
    value: "blocked",
    label: "Blocked",
    icon: ShieldOff,
    color: "text-failure",
  },
]


export const priorities = [
  {
    label: "Low",
    value: "low",
    icon: ArrowDown,
  },
  {
    label: "Medium",
    value: "medium",
    icon: ArrowRight,
  },
  {
    label: "High",
    value: "high",
    icon: ArrowUp,
  },
]
