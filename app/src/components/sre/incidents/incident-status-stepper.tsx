import { Check } from "lucide-react";

import { INCIDENT_DISPLAY_STATUSES, type IncidentDisplayStatus } from "@/lib/sre/incident-status-display";
import { cn } from "@/lib/utils";

/** The six display statuses as a read-only progress line. The current one is highlighted. */
export function IncidentStatusStepper({ current }: { current: IncidentDisplayStatus }) {
  const currentIndex = INCIDENT_DISPLAY_STATUSES.findIndex((status) => status.value === current);
  return (
    <nav aria-label="Incident progress" className="shrink-0 overflow-x-auto">
      <ol className="flex min-w-max items-center gap-2 text-sm">
        {INCIDENT_DISPLAY_STATUSES.map((status, index) => {
          const done = index < currentIndex || (current === "resolved" && index === currentIndex);
          const active = index === currentIndex;
          return (
            <li
              key={status.value}
              aria-current={active ? "step" : undefined}
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
