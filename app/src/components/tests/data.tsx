import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Database,
  Chrome,
  ArrowLeftRight,
  SquareFunction,
} from "lucide-react";


export const priorities = [
  {
    label: "Low",
    value: "low",
    icon: ArrowDown,
    color: "text-gray-400",
  },
  {
    label: "Medium",
    value: "medium",
    icon: ArrowRight,
    color: "text-yellow-500",
  },
  {
    label: "High",
    value: "high",
    icon: ArrowUp,
    color: "text-orange-600",
  },
];

export const types = [
  {
    label: "Browser",
    value: "browser",
    icon: Chrome,
    color: "text-sky-600",
  },
  {
    label: "API",
    value: "api",
    icon: ArrowLeftRight,
    color: "text-teal-600",
  },
  {
    label: "Database",
    value: "database",
    icon: Database,
    color: "text-cyan-600",
  },
  {
    label: "Custom",
    value: "custom",
    icon: SquareFunction,
    color: "text-blue-600",
  },


];
