import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: {
    value: number;
    label: string;
    isPositive?: boolean;
  };
  variant?:
    | "default"
    | "primary"
    | "success"
    | "warning"
    | "danger"
    | "purple"
    | "cyan";
  className?: string;
  metaInline?: boolean;
}

const variantStyles = {
  default: {
    iconBg: "bg-slate-100 dark:bg-slate-800",
    iconColor: "text-slate-600 dark:text-slate-400",
  },
  primary: {
    iconBg: "bg-blue-50 dark:bg-blue-950/50",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  success: {
    iconBg: "bg-success/10",
    iconColor: "text-success",
  },
  warning: {
    iconBg: "bg-warning/10",
    iconColor: "text-warning",
  },
  danger: {
    iconBg: "bg-failure/10",
    iconColor: "text-failure",
  },
  purple: {
    iconBg: "bg-violet-50 dark:bg-violet-950/50",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  cyan: {
    iconBg: "bg-cyan-50 dark:bg-cyan-950/50",
    iconColor: "text-cyan-600 dark:text-cyan-400",
  },
};

export function StatsCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  variant = "default",
  className,
  metaInline = false,
}: StatsCardProps) {
  const styles = variantStyles[variant];
  const trendText = trend
    ? `${trend.isPositive !== false ? "+" : ""}${trend.value} ${trend.label}`
    : null;
  const metaText = metaInline
    ? [description, trendText].filter(Boolean).join(" • ")
    : description;
  const showTrendNearValue = trend && !metaInline;

  return (
    <Card className={cn("relative h-full overflow-hidden", className)}>
      <CardContent className="flex h-full flex-col justify-between gap-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {Icon && (
            <div className={cn("rounded-lg p-2.5", styles.iconBg)}>
              <Icon className={cn("h-5 w-5", styles.iconColor)} />
            </div>
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight tabular-nums">
              {typeof value === "number" ? value.toLocaleString() : value}
            </span>
            {showTrendNearValue && (
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.isPositive !== false ? "text-success" : "text-failure"
                )}
              >
                {trend.isPositive !== false ? "+" : ""}
                {trend.value}
              </span>
            )}
          </div>
          {metaText && (
            <p
              className={cn(
                "text-sm text-muted-foreground",
                metaInline ? "truncate whitespace-nowrap" : undefined
              )}
              title={metaInline ? metaText : undefined}
            >
              {metaText}
            </p>
          )}
          {trend && !metaInline && (
            <p className="text-xs text-muted-foreground">{trend.label}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
