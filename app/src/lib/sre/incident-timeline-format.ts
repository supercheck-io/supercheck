import type { SreIncidentTimelineItem, SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { describeEvidenceBrief, reportHeadline } from "@/lib/sre/evidence-brief-summary";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";

/** Client-safe: shared by the Activity feed and the post-mortem draft so both name events the same way. */
export const STATE_LABELS: Record<string, string> = {
  assigned: "Assignment changed",
  commander_changed: "Commander changed",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  recovered: "Recovered",
  reopened: "Reopened",
  failure_returned: "Failure returned",
  alert_correlated: "Alert linked",
  incident_updated: "Incident updated",
  manual_incident_created: "Incident created",
  created_from_alert_history: "Incident created from alert",
  created_from_background_alert_triage: "Incident created from alert",
  triage_failed: "AI triage failed",
};

function str(value: unknown, max = 600) {
  return typeof value === "string" ? value.slice(0, max) : null;
}

// Each AI row names what produced it instead of a generic "AI finding".
const AI_FINDING_TITLES: Record<string, string> = {
  sre_triage: "AI triage",
  sre_investigation: "AI investigation",
  sre_investigation_failed: "Investigation failed",
  native_evidence_brief: "Evidence brief",
  native_evidence_brief_failed: "Evidence brief failed",
};

/** One plain-text paragraph of an AI report; the full report lives in the Investigation tab. */
export function aiFindingHeadline(value: unknown, max = 220) {
  // Short: the Summary card above already shows the full paragraph.
  return typeof value === "string" ? reportHeadline(value, max) : null;
}

/** "A -> B" lines for the fields an edit changed; empty for events recorded before values were stored. */
function describeEdit(data: Record<string, unknown>) {
  const previous = (data.previous ?? {}) as Record<string, unknown>;
  const current = (data.current ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, label] of [["title", "Title"], ["severity", "Severity"], ["status", "Status"]] as const) {
    // Titles are stored up to 500 characters; compare at that length so late edits still show.
    const from = str(previous[key], 500);
    const to = str(current[key], 500);
    if (from && to && from !== to) {
      const show = (value: string) =>
        key === "title" ? `"${value}"` : key === "status" ? getDisplayStatus(value as never, null).label : value.toUpperCase();
      lines.push(`${label}: ${show(from)} → ${show(to)}`);
    }
  }
  if (previous.primaryServiceId !== undefined && previous.primaryServiceId !== current.primaryServiceId) {
    lines.push("Service changed");
  }
  return lines.join("\n") || null;
}

export function describeTimelineEvent(
  event: Pick<SreIncidentTimelineItem, "eventType" | "eventData">,
  refs?: SreIncidentTimelineRefs,
): {
  title: string;
  body: string | null;
} {
  const data = event.eventData ?? {};
  if (event.eventType === "comment") return { title: "Note", body: str(data.text) };
  if (event.eventType === "ai_finding") {
    return {
      title: (typeof data.type === "string" && AI_FINDING_TITLES[data.type]) || "AI finding",
      body:
        aiFindingHeadline(data.summary) ??
        str(data.error) ??
        // Brief rows stored before the summary was written at the source.
        (data.type === "native_evidence_brief" ? describeEvidenceBrief(data) : null),
    };
  }
  if (event.eventType === "state_change") {
    const state = str(data.state, 80) ?? "";
    if (state === "incident_updated") {
      return { title: STATE_LABELS[state], body: describeEdit(data) ?? str(data.comment) ?? str(data.summary) };
    }
    if (state === "assigned" || state === "commander_changed") {
      const name = (id: unknown) => (typeof id === "string" ? (refs?.users[id] ?? "a former member") : null);
      const from = name(data.previousAssigneeUserId) ?? "Unassigned";
      const to = name(data.assigneeUserId) ?? "Unassigned";
      return { title: STATE_LABELS[state], body: `${from} → ${to}` };
    }
    if (state === "alert_correlated") {
      const alert = str(data.alertTitle, 200) ?? (typeof data.alertEventId === "string" ? refs?.alerts[data.alertEventId] : undefined);
      return { title: STATE_LABELS[state], body: alert ? `Linked: ${alert.slice(0, 200)}` : null };
    }
    return { title: STATE_LABELS[state] ?? "Status change", body: str(data.comment) ?? str(data.summary) };
  }
  return { title: event.eventType.replace(/_/g, " "), body: null };
}
