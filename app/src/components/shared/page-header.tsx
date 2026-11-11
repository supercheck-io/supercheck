import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { IconChip, type IconTone } from "@/components/ui/icon-chip";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Rendered inline, to the right of the title (e.g. a name badge). */
  titleAdornment?: ReactNode;
  /** Primary actions, aligned to the right of the title. */
  actions?: ReactNode;
  /** Optional area icon shown before the title, tinted with the page's product area (see DESIGN.md). */
  icon?: LucideIcon;
  tone?: IconTone;
  className?: string;
}

/**
 * Standard page header: title and one-line description on the left, primary
 * actions on the right. Search and filters belong in a toolbar row below it.
 */
export function PageHeader({ title, description, titleAdornment, actions, icon, tone = "slate", className }: PageHeaderProps) {
  const heading = <h1 className="text-2xl font-semibold">{title}</h1>;
  const text = (
    <div className="min-w-0">
      {titleAdornment ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {heading}
          {titleAdornment}
        </div>
      ) : (
        heading
      )}
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      {icon ? (
        <div className="flex min-w-0 items-start gap-3">
          <IconChip icon={icon} tone={tone} size="md" className="mt-0.5" />
          {text}
        </div>
      ) : (
        text
      )}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
