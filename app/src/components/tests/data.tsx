import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Database,
  Chrome,
  ArrowLeftRight,
  SquareFunction,
} from "lucide-react";
import { K6Logo } from "@/components/logo/k6-logo";

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
    label: "Browser Test",
    value: "browser",
    icon: Chrome,
    color: "text-sky-600",
  },
  {
    label: "API Test",
    value: "api",
    icon: ArrowLeftRight,
    color: "text-teal-600",
  },
  {
    label: "Database Test",
    value: "database",
    icon: Database,
    color: "text-cyan-600",
  },
  {
    label: "Custom Test",
    value: "custom",
    icon: SquareFunction,
    color: "text-blue-600",
  },
  {
    label: "Performance Test",
    value: "performance",
    icon: K6Logo,
    color: "text-purple-600",
  },
];
