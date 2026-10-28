import { cn } from "@/lib/utils";

/**
 * Date cell shared by every table, kept narrow so text columns get the room:
 * "Sep 16 6:47 PM" this year, "Mar 21, 2025 6:47 PM" otherwise, and the full
 * timestamp with time zone on hover.
 */
export function DateCell({
  value,
  empty = "Never",
  showTime = true,
  className,
}: {
  value: Date | string | null | undefined;
  empty?: string;
  showTime?: boolean;
  className?: string;
}) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return (
      <span className={cn("text-sm text-muted-foreground", className)}>
        {empty}
      </span>
    );
  }
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })}
      className={cn("whitespace-nowrap text-sm tabular-nums", className)}
      suppressHydrationWarning
    >
      {date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...(sameYear ? {} : { year: "numeric" }),
      })}
      {showTime && (
        <span className="ml-1.5 text-xs text-muted-foreground" suppressHydrationWarning>
          {date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </span>
      )}
    </time>
  );
}
