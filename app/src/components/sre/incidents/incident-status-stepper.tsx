import { Check } from "lucide-react";

import { INCIDENT_DISPLAY_STATUSES, type IncidentDisplayStatus } from "@/lib/sre/incident-status-display";
import { cn } from "@/lib/utils";

/** The six display statuses as a read-only progress line. The current one is highlighted. */
export function IncidentStatusStepper({
  current,
  acknowledged = false,
  description,
}: {
  current: IncidentDisplayStatus;
  /** Whether someone acknowledged it; a resolved incident may have skipped the middle steps. */
  acknowledged?: boolean;
  /** Explains the current status; shown as a tooltip on the highlighted step. */
  description?: string;
}) {
  const currentIndex = INCIDENT_DISPLAY_STATUSES.findIndex((status) => status.value === current);
  const lastIndex = INCIDENT_DISPLAY_STATUSES.length - 1;
  return (
    <nav aria-label="Incident progress" className="shrink-0 overflow-x-auto">
      <p aria-hidden="true" className="text-sm font-medium sm:hidden">
        Step {currentIndex + 1} of {INCIDENT_DISPLAY_STATUSES.length} · {INCIDENT_DISPLAY_STATUSES[currentIndex]?.label}
      </p>
      <ol className="sr-only items-center gap-2 text-sm sm:not-sr-only sm:flex sm:min-w-max">
        {INCIDENT_DISPLAY_STATUSES.map((status, index) => {
          // Once resolved we only know it was triggered, maybe acknowledged, and resolved;
          // the steps in between may never have happened, so they are not ticked.
          const done =
            current === "resolved"
              ? index === 0 || index === lastIndex || (index === 1 && acknowledged)
              : index < currentIndex;
          const active = index === currentIndex;
          return (
            <li
              key={status.value}
              aria-current={active ? "step" : undefined}
              title={active ? description : undefined}
              data-state={active ? "current" : done ? "done" : "upcoming"}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
                  active && "bg-primary font-semibold text-primary-foreground",
                  done && !active && "text-foreground",
                  !done && !active && "text-muted-foreground",
                )}
              >
                {done && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                {status.label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {index < INCIDENT_DISPLAY_STATUSES.length - 1 && (
                <span aria-hidden="true" className={cn("h-px w-6", index < currentIndex ? "bg-foreground/40" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
