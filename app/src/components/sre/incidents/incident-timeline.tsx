"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRightLeft,
  Bell,
  CircleCheck,
  CircleDot,
  HeartPulse,
  Loader2,
  MessageSquare,
  Pencil,
  RotateCcw,
  Siren,
  Sparkles,
  TriangleAlert,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { draftSreStatusUpdate } from "@/actions/sre-status-update-draft";
import { addSreIncidentUpdate, type SreIncidentTimelineItem, type SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatAgo, useNow } from "@/components/sre/incidents/incident-age";
import { IconTile, SectionTitle, toneButton, type IconTone } from "@/components/sre/incidents/incident-ui";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserCell } from "@/components/ui/user-cell";
import { useSreIncidentTimeline } from "@/hooks/use-sre";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey, getSreIncidentTimelineQueryKey } from "@/lib/sre/query-keys";
import { describeTimelineEvent } from "@/lib/sre/incident-timeline-format";
import { describeNotificationEvent } from "@/lib/sre/incident-notification-event";

export { aiFindingHeadline, describeTimelineEvent } from "@/lib/sre/incident-timeline-format";

const STATE_VISUAL: Record<string, { icon: LucideIcon; tone: IconTone }> = {
  acknowledged: { icon: UserCheck, tone: "amber" },
  resolved: { icon: CircleCheck, tone: "emerald" },
  recovered: { icon: HeartPulse, tone: "emerald" },
  reopened: { icon: RotateCcw, tone: "rose" },
  failure_returned: { icon: RotateCcw, tone: "rose" },
  assigned: { icon: ArrowRightLeft, tone: "slate" },
  commander_changed: { icon: ArrowRightLeft, tone: "slate" },
  alert_correlated: { icon: Bell, tone: "amber" },
  incident_updated: { icon: Pencil, tone: "slate" },
  manual_incident_created: { icon: Siren, tone: "rose" },
  created_from_alert_history: { icon: Siren, tone: "rose" },
  created_from_background_alert_triage: { icon: Siren, tone: "rose" },
  triage_failed: { icon: TriangleAlert, tone: "rose" },
};

/** Icon and colour for a timeline row, so the kind of event reads before its text. */
export function timelineEventVisual(event: Pick<SreIncidentTimelineItem, "eventType" | "eventData">): { icon: LucideIcon; tone: IconTone } {
  const data = event.eventData ?? {};
  if (event.eventType === "comment") return { icon: MessageSquare, tone: "blue" };
  if (event.eventType === "ai_finding") {
    return typeof data.type === "string" && data.type.endsWith("_failed")
      ? { icon: TriangleAlert, tone: "rose" }
      : { icon: Sparkles, tone: "violet" };
  }
  if (event.eventType === "notification") {
    return describeNotificationEvent(data).warning ? { icon: TriangleAlert, tone: "amber" } : { icon: Bell, tone: "slate" };
  }
  if (event.eventType === "state_change" && typeof data.state === "string" && STATE_VISUAL[data.state]) {
    return STATE_VISUAL[data.state]!;
  }
  return { icon: CircleDot, tone: "slate" };
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
  const now = useNow();
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
    if (pending || drafting || !text.trim()) return;
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
    // Posting a note also makes the author a watcher, which the header reads from the detail query.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getSreIncidentTimelineQueryKey(projectId, incidentId) }),
      queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incidentId) }),
    ]);
  };

  return (
    <Card data-testid="incident-timeline" className="shadow-none flex flex-col gap-4 py-4">
      <CardHeader className="shrink-0 px-4 py-0">
        {/* No count at the fetch cap, where it would understate the total. */}
        <SectionTitle as="h2" icon={Activity} tone="blue" count={events.length > 0 && events.length < TIMELINE_FETCH_LIMIT ? events.length : undefined}>
          Activity
        </SectionTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-4 pb-0">
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
              disabled={pending || drafting}
              placeholder="Add a note for your team..."
              className="min-h-9 max-h-24 resize-none py-2"
            />
            <Button size="sm" onClick={post} disabled={pending || drafting || !text.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Add note
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="button" variant="outline" size="sm" className={`h-7 px-2 ${toneButton("violet")}`} onClick={draft} disabled={drafting || pending}>
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
            <ol>
              {(showAll ? events : events.slice(0, TIMELINE_COLLAPSED)).map((event, index, shown) => {
                const { title, body } = describeTimelineEvent(event, refs);
                const visual = timelineEventVisual(event);
                const last = index === shown.length - 1;
                return (
                  <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {/* The rail joins each icon to the next row. */}
                    {!last && <span aria-hidden="true" className="absolute left-3 top-7 bottom-0 w-px -translate-x-1/2 bg-border" />}
                    <IconTile icon={visual.icon} tone={visual.tone} className="relative z-10 rounded-full" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm font-medium">{title}</span>
                        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {event.actorName ? (
                            <UserCell name={event.actorName} image={event.actorImage} avatarClassName="h-4 w-4" className="text-xs" />
                          ) : (
                            event.actorType === "agent" ? "AI" : "System"
                          )}
                          <span aria-hidden="true">·</span>
                          <time
                            dateTime={new Date(event.createdAt).toISOString()}
                            title={formatTime(event.createdAt)}
                            suppressHydrationWarning
                          >
                            {formatAgo(event.createdAt, now)}
                          </time>
                        </span>
                      </div>
                      {body && <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-muted-foreground">{body}</p>}
                    </div>
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
