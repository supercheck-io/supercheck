"use client";

import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { addSreIncidentUpdate, type SreIncidentTimelineItem } from "@/actions/sre-incident-lifecycle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/ui/user-cell";
import { useSreIncidentTimeline } from "@/hooks/use-sre";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentTimelineQueryKey } from "@/lib/sre/query-keys";
import { stripEvidenceIdLists } from "@/sre/lib/investigation-output";

const STATE_LABELS: Record<string, string> = {
  assigned: "Assignment changed",
  commander_changed: "Commander changed",
  acknowledged: "Acknowledged",
  resolved: "Resolved",
  recovered: "Recovered",
  reopened: "Reopened",
  incident_updated: "Incident updated",
  manual_incident_created: "Incident created",
  created_from_alert_history: "Incident created from alert",
  created_from_background_alert_triage: "Incident created from alert",
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

export function describeTimelineEvent(event: Pick<SreIncidentTimelineItem, "eventType" | "eventData">): {
  title: string;
  body: string | null;
} {
  const data = event.eventData ?? {};
  if (event.eventType === "comment") return { title: "Update", body: str(data.text) };
  if (event.eventType === "ai_finding") {
    return { title: "AI finding", body: aiFindingHeadline(data.summary) ?? str(data.error) };
  }
  if (event.eventType === "state_change") {
    const state = str(data.state, 80) ?? "";
    return { title: STATE_LABELS[state] ?? "Status change", body: str(data.comment) ?? str(data.summary) };
  }
  return { title: event.eventType.replace(/_/g, " "), body: null };
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function IncidentTimeline({
  incidentId,
  canUpdate,
}: {
  incidentId: string;
  canUpdate: boolean;
}) {
  const id = useId();
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const query = useSreIncidentTimeline(incidentId);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const events = query.data?.success ? query.data.events : [];

  const post = async () => {
    if (pending || !text.trim()) return;
    setPending(true);
    const result = await addSreIncidentUpdate({ incidentId, text }).catch(() => null).finally(() => setPending(false));
    if (!result?.success) {
      toast.error(result?.error ?? "Failed to add update");
      return;
    }
    setText("");
    await queryClient.invalidateQueries({ queryKey: getSreIncidentTimelineQueryKey(projectId, incidentId) });
  };

  return (
    <Card data-testid="incident-timeline" className="flex min-h-0 flex-1 flex-col gap-3 py-4">
      <CardHeader className="shrink-0 px-4 py-0">
        <CardTitle className="text-sm">Timeline</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 px-4">
        {canUpdate && (
          <div className="flex shrink-0 items-end gap-2">
            <Label htmlFor={id} className="sr-only">
              Post an update
            </Label>
            <Textarea
              id={id}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={2000}
              rows={1}
              disabled={pending}
              placeholder="Write an update..."
              className="min-h-9 max-h-24 resize-none py-2"
            />
            <Button size="sm" onClick={post} disabled={pending || !text.trim()}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Post
            </Button>
          </div>
        )}
        <div className="max-h-96 min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-none">
          {query.isPending ? (
            <p className="text-sm text-muted-foreground">Loading timeline...</p>
          ) : query.data && !query.data.success ? (
            <p role="alert" className="text-sm text-destructive">{query.data.error}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ol className="ml-1 space-y-3 border-l pl-4">
              {events.map((event) => {
                const { title, body } = describeTimelineEvent(event);
                return (
                  <li key={event.id} className="relative">
                    <span aria-hidden="true" className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-border" />
                    <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium">{title}</span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        {event.actorName && <UserAvatar name={event.actorName} image={event.actorImage} className="h-4 w-4" />}
                        {event.actorName ?? (event.actorType === "agent" ? "AI" : "System")}
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
        </div>
      </CardContent>
    </Card>
  );
}
