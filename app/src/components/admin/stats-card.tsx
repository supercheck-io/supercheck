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
    iconBg: "bg-emerald-50 dark:bg-emerald-950/50",
    iconColor: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    iconBg: "bg-amber-50 dark:bg-amber-950/50",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    iconBg: "bg-red-50 dark:bg-red-950/50",
    iconColor: "text-red-600 dark:text-red-400",
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
      <CardContent className="p-5 h-full">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5 min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tracking-tight">
                {typeof value === "number" ? value.toLocaleString() : value}
              </span>
              {showTrendNearValue && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    trend.isPositive !== false
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
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
                  "text-xs text-muted-foreground",
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
          {Icon && (
            <div className={cn("rounded-lg p-2", styles.iconBg)}>
              <Icon className={cn("h-4 w-4", styles.iconColor)} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
