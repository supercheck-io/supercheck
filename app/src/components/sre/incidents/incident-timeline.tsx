"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { draftSreStatusUpdate } from "@/actions/sre-status-update-draft";
import { addSreIncidentUpdate, type SreIncidentTimelineItem, type SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserCell } from "@/components/ui/user-cell";
import { useSreIncidentTimeline } from "@/hooks/use-sre";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentTimelineQueryKey } from "@/lib/sre/query-keys";
import { getDisplayStatus } from "@/lib/sre/incident-status-display";
import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

const STATE_LABELS: Record<string, string> = {
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

/** First paragraph of an AI report as plain text; the full report lives in Investigation details. */
export function aiFindingHeadline(value: unknown) {
  if (typeof value !== "string") return null;
  const firstParagraph = stripEvidenceIdLists(value.trim().split(/\n\s*\n/)[0] ?? "");
  const plain = firstParagraph
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;
  if (plain.length <= 400) return plain;
  const cut = plain.slice(0, 400);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 300 ? cut.lastIndexOf(" ") : 400)}…`;
}

/** "A -> B" lines for the fields an edit changed; empty for events recorded before values were stored. */
function describeEdit(data: Record<string, unknown>) {
  const previous = (data.previous ?? {}) as Record<string, unknown>;
  const current = (data.current ?? {}) as Record<string, unknown>;
  const lines: string[] = [];
  for (const [key, label] of [["title", "Title"], ["severity", "Severity"], ["status", "Status"]] as const) {
    const from = str(previous[key], 200);
    const to = str(current[key], 200);
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
    return { title: "AI finding", body: aiFindingHeadline(data.summary) ?? str(data.error) };
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

const TIMELINE_COLLAPSED = 20;
// getSreIncidentTimeline returns at most this many of the newest events.
const TIMELINE_FETCH_LIMIT = 500;

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function IncidentTimeline({
  incidentId,
  canUpdate,
  canPostToStatusPage = false,
}: {
  incidentId: string;
  canUpdate: boolean;
  /** Set only when the incident has an open linked status page incident and the user may update status pages. */
  canPostToStatusPage?: boolean;
}) {
  const id = useId();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const query = useSreIncidentTimeline(incidentId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [postToStatusPage, setPostToStatusPage] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const events = query.data?.success ? query.data.events : [];
  const refs = query.data?.success ? query.data.refs : undefined;

  // Only fills the box: the person edits it and presses Add note.
  const draft = async () => {
    if (drafting || pending) return;
    setDrafting(true);
    const result = await draftSreStatusUpdate({ incidentId }).catch(() => null).finally(() => setDrafting(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Could not draft an update");
      return;
    }
    setText(result.text);
  };

  const post = async () => {
    if (pending || !text.trim()) return;
    setPending(true);
    const result = await addSreIncidentUpdate({ incidentId, text, ...(canPostToStatusPage && postToStatusPage ? { postToStatusPage: true } : {}) })
      .catch(() => null)
      .finally(() => setPending(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Failed to add note");
      return;
    }
    if (result.warning) toast.warning(result.warning);
    setText("");
    setPostToStatusPage(false);
    await queryClient.invalidateQueries({ queryKey: getSreIncidentTimelineQueryKey(projectId, incidentId) });
  };

  return (
    <Card data-testid="incident-timeline" className="flex flex-col gap-3 py-4">
      <CardHeader className="shrink-0 px-4 py-0">
        <CardTitle className="text-sm">Timeline</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 pb-0">
        {canUpdate && (
          <div className="flex shrink-0 flex-col gap-2">
          <div className="flex items-end gap-2">
            <Label htmlFor={id} className="sr-only">
              Add a note
            </Label>
            <Textarea
              id={id}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              rows={1}
              disabled={pending}
              placeholder="Add a note for your team..."
              className="min-h-9 max-h-24 resize-none py-2"
            />
            <Button size="sm" onClick={post} disabled={pending || !text.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add note
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={draft} disabled={drafting || pending}>
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Draft customer update with AI
          </Button>
          {canPostToStatusPage && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={postToStatusPage} onCheckedChange={(checked) => setPostToStatusPage(checked === true)} disabled={pending} />
              Also post to status page (subscribers are emailed)
            </label>
          )}
          </div>
          </div>
        )}
        <div>
          {query.isPending ? (
            <p className="text-sm text-muted-foreground">Loading timeline...</p>
          ) : (query.isError && !query.data) || (query.data && !query.data.success) ? (
            <div role="alert" className="flex items-center gap-2 text-sm text-destructive">
              <span>{query.data && !query.data.success ? query.data.error : "Could not load the timeline."}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="ml-1 space-y-3 border-l pl-4">
              {(showAll ? events : events.slice(0, TIMELINE_COLLAPSED)).map((event) => {
                const { title, body } = describeTimelineEvent(event, refs);
                return (
                  <li key={event.id} className="relative">
                    <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                      <span className="font-medium">{title}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {event.actorName ? (
                          <UserCell name={event.actorName} image={event.actorImage} avatarClassName="h-4 w-4" className="text-xs" />
                        ) : (
                          event.actorType === "agent" ? "AI" : "System"
                        )}
                        {" · "}
                        <time dateTime={new Date(event.createdAt).toISOString()} suppressHydrationWarning>
                          {formatTime(event.createdAt)}
                        </time>
                      </span>
                    </div>
                    {body && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{body}</p>}
                  </li>
                );
              })}
            </ol>
          )}
          {events.length > TIMELINE_COLLAPSED && (
            <Button type="button" variant="link" size="sm" className="mt-2 h-auto px-0 text-muted-foreground" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll
                ? "Show fewer"
                : events.length >= TIMELINE_FETCH_LIMIT
                  ? `Show the ${events.length} most recent events`
                  : `Show all ${events.length} events`}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
