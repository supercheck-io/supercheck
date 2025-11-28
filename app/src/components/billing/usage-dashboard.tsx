"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, TrendingUp, Activity, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface UsageMeterProps {
  label: string;
  used: number;
  included: number;
  unit: string;
  icon?: React.ReactNode;
  showOverage?: boolean;
  overage?: number;
  overageCost?: number;
  className?: string;
}

/**
 * UsageMeter Component
 *
 * Displays a single usage metric with progress bar and optional overage information.
 */
export function UsageMeter({
  label,
  used,
  included,
  unit,
  icon,
  showOverage = false,
  overage = 0,
  overageCost = 0,
  className = "",
}: UsageMeterProps) {
  const percentage = Math.min((used / included) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isOverLimit = percentage >= 100;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {used.toLocaleString()} / {included.toLocaleString()} {unit}
          </span>
          {isNearLimit && (
            <Badge variant={isOverLimit ? "destructive" : "secondary"} className="text-xs">
              {Math.round(percentage)}%
            </Badge>
          )}
        </div>
      </div>

      <Progress
        value={percentage}
        className={cn(
          "h-2",
          isOverLimit && "bg-red-100 dark:bg-red-950",
          isNearLimit && !isOverLimit && "bg-amber-100 dark:bg-amber-950"
        )}
        indicatorClassName={cn(
          isOverLimit && "bg-red-600",
          isNearLimit && !isOverLimit && "bg-amber-600"
        )}
      />

      {isNearLimit && (
        <div className={cn(
          "flex items-center gap-2 text-sm",
          isOverLimit ? "text-red-600" : "text-amber-600"
        )}>
          <AlertTriangle className="h-4 w-4" />
          <span>
            {isOverLimit ? "Over limit" : "Approaching limit"}
          </span>
        </div>
      )}

      {showOverage && overage > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-md border border-amber-200 dark:border-amber-800">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
              Overage: {overage.toLocaleString()} {unit}
            </span>
            {overageCost > 0 && (
              <span className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                +${overageCost.toFixed(2)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface LimitCardProps {
  label: string;
  current: number;
  limit: number;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * LimitCard Component
 *
 * Displays resource limit as a simple card with current/limit display.
 */
export function LimitCard({ label, current, limit, icon, className = "" }: LimitCardProps) {
  const percentage = (current / limit) * 100;
  const isNearLimit = percentage >= 80;

  return (
    <div className={cn("p-4 rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between mb-2">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-baseline justify-between">
        <span className="text-3xl font-bold">{current}</span>
        <span className="text-sm text-muted-foreground">/ {limit}</span>
      </div>
      {isNearLimit && (
        <Badge variant="secondary" className="mt-2 text-xs">
          {Math.round(percentage)}% used
        </Badge>
      )}
    </div>
  );
}

interface UsageDashboardProps {
  usage: {
    playwrightMinutes: { used: number; included: number; overage: number; percentage: number };
    k6VuMinutes: { used: number; included: number; overage: number; percentage: number };
  };
  limits: {
    monitors: { current: number; limit: number; percentage: number };
    statusPages: { current: number; limit: number; percentage: number };
    projects: { current: number; limit: number; percentage: number };
    teamMembers: { current: number; limit: number; percentage: number };
  };
  plan: {
    name: string;
    overagePricing?: {
      playwrightMinutes: number;
      k6VuMinutes: number;
    };
  };
  periodEnd?: Date;
  className?: string;
}

/**
 * UsageDashboard Component
 *
 * Complete usage dashboard showing all resource usage and limits.
 * Can be embedded in billing page or main dashboard.
 *
 * @example
 * ```tsx
 * <UsageDashboard
 *   usage={billingData.usage}
 *   limits={billingData.limits}
 *   plan={{ name: "Plus" }}
 * />
 * ```
 */
export function UsageDashboard({
  usage,
  limits,
  plan,
  periodEnd,
  className = "",
}: UsageDashboardProps) {
  const playwrightOverageCost = usage.playwrightMinutes.overage * (plan.overagePricing?.playwrightMinutes || 0);
  const k6OverageCost = usage.k6VuMinutes.overage * (plan.overagePricing?.k6VuMinutes || 0);
  const totalOverageCost = playwrightOverageCost + k6OverageCost;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Usage Metrics */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Usage This Month</CardTitle>
              <CardDescription>
                {periodEnd && `Resets on ${new Date(periodEnd).toLocaleDateString()}`}
              </CardDescription>
            </div>
            {totalOverageCost > 0 && (
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Estimated overage</p>
                <p className="text-2xl font-bold text-amber-600">
                  +${totalOverageCost.toFixed(2)}
                </p>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <UsageMeter
            label="Playwright Execution Minutes"
            used={usage.playwrightMinutes.used}
            included={usage.playwrightMinutes.included}
            unit="minutes"
            icon={<Activity className="h-4 w-4" />}
            showOverage
            overage={usage.playwrightMinutes.overage}
            overageCost={playwrightOverageCost}
          />

          <UsageMeter
            label="K6 Virtual User Minutes"
            used={usage.k6VuMinutes.used}
            included={usage.k6VuMinutes.included}
            unit="VU minutes"
            icon={<TrendingUp className="h-4 w-4" />}
            showOverage
            overage={usage.k6VuMinutes.overage}
            overageCost={k6OverageCost}
          />
        </CardContent>
      </Card>

      {/* Resource Limits */}
      <Card>
        <CardHeader>
          <CardTitle>Resource Limits</CardTitle>
          <CardDescription>
            Current usage across all resources
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <LimitCard
              label="Monitors"
              current={limits.monitors.current}
              limit={limits.monitors.limit}
              icon={<Clock className="h-4 w-4" />}
            />
            <LimitCard
              label="Status Pages"
              current={limits.statusPages.current}
              limit={limits.statusPages.limit}
            />
            <LimitCard
              label="Projects"
              current={limits.projects.current}
              limit={limits.projects.limit}
            />
            <LimitCard
              label="Team Members"
              current={limits.teamMembers.current}
              limit={limits.teamMembers.limit}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
