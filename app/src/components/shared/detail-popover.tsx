import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Header strip shared by the details popovers (Agent results, AI details, MCP tools): a coloured icon,
 * the title, optional muted text beside it and a muted note on the right. Use with `PopoverContent className="p-0"`.
 */
export function DetailPopoverHeader({
  icon: Icon,
  iconClass,
  title,
  aside,
  meta,
}: {
  icon: LucideIcon;
  iconClass?: string;
  title: string;
  /** Muted text right after the title, such as a count. */
  aside?: ReactNode;
  /** Muted text on the right, such as "Latest check". */
  meta?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 border-b px-4 py-3">
      <Icon className={cn("h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <h4 className="shrink-0 text-sm font-semibold">{title}</h4>
      {aside}
      {meta ? <div className="ml-auto min-w-0 break-words text-right text-xs text-muted-foreground">{meta}</div> : null}
    </div>
  );
}

/** One labelled number in a details popover, with a coloured icon; a missing value shows a dash. */
export function DetailStat({
  icon: Icon,
  iconClass,
  label,
  value,
  valueClass,
  testId,
}: {
  icon: LucideIcon;
  iconClass: string;
  label: string;
  value: string | null;
  valueClass?: string;
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testId}>
      <Icon className={cn("h-4 w-4 shrink-0", iconClass)} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className={cn("break-words text-sm font-semibold tabular-nums", valueClass)}>
          {value ?? <span className="text-muted-foreground">—</span>}
        </div>
      </div>
    </div>
  );
}
