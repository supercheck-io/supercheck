import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TableBadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "purple"
  | "indigo"
  | "slate";

const tableBadgeToneClasses: Record<TableBadgeTone, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  purple: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  indigo: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  slate: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
};

export const TABLE_BADGE_BASE_CLASS = "h-6 rounded-md px-2.5 text-xs font-medium";
export const TABLE_BADGE_COMPACT_CLASS = "h-6 rounded-md px-2 text-xs font-medium";

type TableBadgeProps = Omit<React.ComponentProps<typeof Badge>, "variant"> & {
  tone?: TableBadgeTone;
  compact?: boolean;
};

export function TableBadge({
  tone = "neutral",
  compact = false,
  className,
  children,
  ...props
}: TableBadgeProps) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        compact ? TABLE_BADGE_COMPACT_CLASS : TABLE_BADGE_BASE_CLASS,
        tableBadgeToneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </Badge>
  );
}
