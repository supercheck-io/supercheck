import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface TabSectionHeaderProps {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * Shared header for the Organization admin tabs: title and description on the
 * left, the primary action (when the tab has one outside its table toolbar)
 * on the right.
 */
export function TabSectionHeader({
  title,
  description,
  icon,
  action,
  className,
}: TabSectionHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
          {icon && (
            <span className="text-muted-foreground [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </span>
          )}
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
