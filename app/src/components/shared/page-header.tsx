import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Primary actions, aligned to the right of the title. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page header: title and one-line description on the left, primary
 * actions on the right. Search and filters belong in a toolbar row below it.
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
