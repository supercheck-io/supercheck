import type { TableBadgeTone } from "@/components/ui/table-badge";

type StoredStatus =
  | "triggered"
  | "investigating"
  | "identified"
  | "recommendations_ready"
  | "user_applying_fix"
  | "verifying"
  | "resolved";

/** The six statuses users see. The stored enum keeps its seven values. */
export type IncidentDisplayStatus =
  | "triggered"
  | "acknowledged"
  | "investigating"
  | "fixing"
  | "monitoring"
  | "resolved";

export const INCIDENT_DISPLAY_STATUSES: ReadonlyArray<{
  value: IncidentDisplayStatus;
  label: string;
  tone: TableBadgeTone;
  description: string;
}> = [
  { value: "triggered", label: "Triggered", tone: "danger", description: "An alert opened this incident and nobody has acknowledged it yet." },
  { value: "acknowledged", label: "Acknowledged", tone: "purple", description: "Someone is on it. Escalation stops." },
  { value: "investigating", label: "Investigating", tone: "info", description: "The team or the AI is looking for the cause." },
  { value: "fixing", label: "Fixing", tone: "indigo", description: "The cause is known and a fix is being prepared or applied." },
  { value: "monitoring", label: "Monitoring", tone: "warning", description: "A fix is in place. Watching to confirm it holds." },
  { value: "resolved", label: "Resolved", tone: "success", description: "The incident is over." },
];

export function toDisplayStatus(status: StoredStatus, acknowledgedAt: Date | string | null): IncidentDisplayStatus {
  switch (status) {
    case "triggered":
      return acknowledgedAt ? "acknowledged" : "triggered";
    case "investigating":
      return "investigating";
    case "identified":
    case "recommendations_ready":
    case "user_applying_fix":
      return "fixing";
    case "verifying":
      return "monitoring";
    case "resolved":
      return "resolved";
  }
}

export function getDisplayStatus(status: StoredStatus, acknowledgedAt: Date | string | null) {
  const value = toDisplayStatus(status, acknowledgedAt);
  // A status this build does not know (newer server, bad row) still renders rather than throwing.
  return (
    INCIDENT_DISPLAY_STATUSES.find((entry) => entry.value === value) ?? {
      value: "investigating" as const,
      label: String(status ?? "Unknown").replace(/_/g, " "),
      tone: "slate" as TableBadgeTone,
      description: "",
    }
  );
}
