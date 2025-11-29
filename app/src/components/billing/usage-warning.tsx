"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, AlertCircle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export type ResourceType =
  | "playwright"
  | "k6"
  | "monitors"
  | "statusPages"
  | "projects"
  | "teamMembers";

interface UsageWarningProps {
  type: ResourceType;
  used: number;
  limit: number;
  percentage: number;
  className?: string;
  onUpgradeClick?: () => void;
}

const RESOURCE_LABELS: Record<ResourceType, string> = {
  playwright: "Playwright minutes",
  k6: "K6 VU minutes",
  monitors: "monitors",
  statusPages: "status pages",
  projects: "projects",
  teamMembers: "team members",
};

const RESOURCE_UNITS: Record<ResourceType, string> = {
  playwright: "minutes",
  k6: "VU minutes",
  monitors: "",
  statusPages: "",
  projects: "",
  teamMembers: "",
};

/**
 * UsageWarning Component
 *
 * Displays warning banners when resource usage reaches 80% or 100% of plan limits.
 * Provides upgrade prompts for users approaching or exceeding their quotas.
 *
 * @example
 * ```tsx
 * <UsageWarning
 *   type="playwright"
 *   used={450}
 *   limit={500}
 *   percentage={90}
 * />
 * ```
 */
export function UsageWarning({
  type,
  used,
  limit,
  percentage,
  className = "",
  onUpgradeClick,
}: UsageWarningProps) {
  // Don't show warning if usage is below 80%
  if (percentage < 80) return null;

  const is100 = percentage >= 100;
  const Icon = is100 ? AlertCircle : AlertTriangle;
  const variant = is100 ? "destructive" : "default";
  const label = RESOURCE_LABELS[type];
  const unit = RESOURCE_UNITS[type];

  const handleUpgradeClick = () => {
    if (onUpgradeClick) {
      onUpgradeClick();
    }
  };

  return (
    <Alert variant={variant} className={`${className} border-l-4`}>
      <Icon className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <p className="font-medium">
            {is100
              ? `You've reached your limit of ${limit} ${label}`
              : `You're approaching your limit for ${label}`
            }
          </p>
          <p className="text-sm mt-1 opacity-90">
            Current usage: {used}{unit ? ` ${unit}` : ""} / {limit}{unit ? ` ${unit}` : ""} ({percentage}%)
            {is100 && " - Upgrade now to continue"}
          </p>
        </div>
        <Link href="/billing" passHref>
          <Button
            size="sm"
            variant={is100 ? "default" : "outline"}
            onClick={handleUpgradeClick}
            className="whitespace-nowrap"
          >
            {is100 ? "Upgrade Now" : "View Plans"}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/**
 * MultiUsageWarning Component
 *
 * Displays multiple usage warnings stacked vertically.
 * Automatically filters out resources below 80% usage.
 */
interface MultiUsageWarningProps {
  warnings: Array<{
    type: ResourceType;
    used: number;
    limit: number;
    percentage: number;
  }>;
  className?: string;
}

export function MultiUsageWarning({ warnings, className = "" }: MultiUsageWarningProps) {
  const activeWarnings = warnings.filter(w => w.percentage >= 80);

  if (activeWarnings.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {activeWarnings.map((warning) => (
        <UsageWarning key={warning.type} {...warning} />
      ))}
    </div>
  );
}
