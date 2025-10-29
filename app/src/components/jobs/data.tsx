import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle,
  Clock,
  PlayCircle,
  XCircle,
  AlertCircle,
} from "lucide-react"

export const jobStatuses = [
  {
    value: "pending",
    label: "Pending",
    icon: Clock,
    color: "text-gray-500",
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
