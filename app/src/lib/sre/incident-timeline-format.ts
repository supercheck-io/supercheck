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

type TimelineEventKind = Pick<SreIncidentTimelineItem, "eventType" | "eventData">;

// Draft rows read "<title>: <detail>"; a known title maps back to its event so the post-mortem can reuse the Activity icons.
const EVENT_FOR_TITLE = new Map<string, TimelineEventKind>([
  ["Note", { eventType: "comment", eventData: {} }],
  ...Object.entries(AI_FINDING_TITLES).map(([type, title]): [string, TimelineEventKind] => [title, { eventType: "ai_finding", eventData: { type } }]),
  ...Object.entries(STATE_LABELS).map(([state, title]): [string, TimelineEventKind] => [title, { eventType: "state_change", eventData: { state } }]),
]);
// Longest first, so "AI triage failed" wins over "AI triage".
const KNOWN_TITLES = [...EVENT_FOR_TITLE.keys()].sort((a, b) => b.length - a.length);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "- 6 Oct 2026, 14:58 UTC: text" is the draft format; "- 2026-10-26T23:49:24Z — text" is how models often write it.
const SEPARATOR = String.raw`(?:\s*:(?!\d)\s*|\s*[\u2014\u2013]\s*|\s+-\s+)`;
const DRAFT_MOMENT = new RegExp(String.raw`^\s*(?:[-*]\s+)?(\d{1,2}) ([A-Z][a-z]{2}) (\d{4}),? (\d{2}):(\d{2}) UTC${SEPARATOR}(.*)$`);
const ISO_MOMENT = new RegExp(String.raw`^\s*(?:[-*]\s+)?(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:Z|UTC)${SEPARATOR}(.*)$`);

// Moments without a known title still get an icon from what the sentence says.
const INFERRED_EVENTS: Array<[RegExp, TimelineEventKind]> = [
  [/\bresolved\b/i, { eventType: "state_change", eventData: { state: "resolved" } }],
  [/\brecovered\b/i, { eventType: "state_change", eventData: { state: "recovered" } }],
  [/\b(?:reopen(?:ed)?|failure returned)\b/i, { eventType: "state_change", eventData: { state: "reopened" } }],
  [/\backnowledg/i, { eventType: "state_change", eventData: { state: "acknowledged" } }],
  [/\b(?:created|opened|declared)\b/i, { eventType: "state_change", eventData: { state: "manual_incident_created" } }],
  [/\b(?:AI|investigation|triage|finding)\b/, { eventType: "ai_finding", eventData: { type: "sre_investigation" } }],
  [/\balert/i, { eventType: "state_change", eventData: { state: "alert_correlated" } }],
];

export type PostmortemMoment = {
  /** "26 Oct 2026", UTC. */
  date: string;
  /** "23:49", UTC. */
  time: string;
  title: string | null;
  detail: string;
  event: TimelineEventKind | null;
};

/** A real calendar day and clock time, so "31 Feb" or "25:99" fall back to the text as written. */
function validMoment(year: number, month: number, day: number, hour: number, minute: number) {
  if (month < 0 || month > 11 || hour > 23 || minute > 59) return false;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day;
}

function momentWhen(line: string): { date: string; time: string; rest: string } | null {
  const draft = DRAFT_MOMENT.exec(line);
  if (draft) {
    const month = MONTHS.indexOf(draft[2]!);
    if (!validMoment(Number(draft[3]), month, Number(draft[1]), Number(draft[4]), Number(draft[5]))) return null;
    return { date: `${Number(draft[1])} ${draft[2]} ${draft[3]}`, time: `${draft[4]}:${draft[5]}`, rest: draft[6]! };
  }
  const iso = ISO_MOMENT.exec(line);
  if (!iso) return null;
  const month = Number(iso[2]) - 1;
  if (!validMoment(Number(iso[1]), month, Number(iso[3]), Number(iso[4]), Number(iso[5]))) return null;
  return { date: `${Number(iso[3])} ${MONTHS[month]} ${iso[1]}`, time: `${iso[4]}:${iso[5]}`, rest: iso[6]! };
}

/**
 * Reads a timeline written one moment per line ("- 6 Oct 2026, 14:58 UTC: Resolved: detail", or an ISO
 * timestamp) as moments. Null when any line has another shape, so hand-written text is shown as written.
 */
export function parsePostmortemTimeline(text: string): PostmortemMoment[] | null {
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return null;
  const moments: PostmortemMoment[] = [];
  for (const line of lines) {
    const when = momentWhen(line);
    if (!when) return null;
    const rest = when.rest.trim();
    if (!rest) return null;
    // Titles match without emphasis; the detail keeps its inline markdown for the renderer.
    const bare = rest.replace(/\*\*|__|`/g, "");
    const title = KNOWN_TITLES.find((known) => bare === known || bare.startsWith(`${known}:`)) ?? null;
    moments.push({
      date: when.date,
      time: when.time,
      title,
      detail: title ? (rest.includes(":") ? rest.slice(rest.indexOf(":") + 1).trim() : "") : rest,
      event: title ? EVENT_FOR_TITLE.get(title)! : (INFERRED_EVENTS.find(([pattern]) => pattern.test(bare))?.[1] ?? null),
    });
  }
  return moments;
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
