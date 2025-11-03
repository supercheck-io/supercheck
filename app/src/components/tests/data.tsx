import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Database,
  Chrome,
  ArrowLeftRight,
  SquareFunction,
} from "lucide-react";
import type { ComponentType } from "react";
import { K6Logo } from "@/components/logo/k6-logo";

interface TestTypeOption {
  label: string;
  value: string;
  icon: ComponentType<Record<string, unknown>>;
  color: string;
  iconProps?: Record<string, unknown>;
}

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

export const types: TestTypeOption[] = [
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
  {
    label: "Performance",
    value: "performance",
    icon: K6Logo,
    color: "text-purple-600",
    iconProps: {
      size: 16,
    },
  },
];
