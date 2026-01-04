import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    CheckCircle,
    XCircle,
    CircleDashed,
} from "lucide-react";
import type { ComponentType } from "react";

interface FilterOption {
    label: string;
    value: string;
    icon: ComponentType<Record<string, unknown>>;
    color: string;
}

// Same priority options as tests for consistency
export const priorities: FilterOption[] = [
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

export const coverageStatuses: FilterOption[] = [
    {
        label: "Covered",
        value: "covered",
        icon: CheckCircle,
        color: "text-green-500",
    },
    {
        label: "Failing",
        value: "failing",
        icon: XCircle,
        color: "text-red-500",
    },
    {
        label: "Missing",
        value: "missing",
        icon: CircleDashed,
        color: "text-gray-400",
    },
];
