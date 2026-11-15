import { CheckCircle, Clock, Hourglass, Pause, XCircle, type LucideIcon } from "lucide-react";
import { TableBadge, type TableBadgeTone } from "@/components/ui/table-badge";
import type { HeartbeatDisplayState } from "@/lib/heartbeat/state";

const STATES: Record<HeartbeatDisplayState, { label: string; tone: TableBadgeTone; icon: LucideIcon }> = {
  up: { label: "Up", tone: "success", icon: CheckCircle },
  // Late is derived (still up, ping overdue inside the grace period): warning tone with a clock, never colour alone.
  late: { label: "Late", tone: "warning", icon: Clock },
  down: { label: "Down", tone: "danger", icon: XCircle },
  pending: { label: "Pending", tone: "neutral", icon: Hourglass },
  paused: { label: "Paused", tone: "neutral", icon: Pause },
};

export function heartbeatStateLabel(state: HeartbeatDisplayState): string {
  return STATES[state].label;
}

export function HeartbeatStateBadge({ state }: { state: HeartbeatDisplayState }) {
  const { label, tone, icon: Icon } = STATES[state] ?? STATES.pending;
  return (
    <TableBadge tone={tone} className="gap-1" data-testid="heartbeat-state-badge" data-state={state}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </TableBadge>
  );
}
