"use client";

import { useId, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useProjectContext } from "@/hooks/use-project-context";
import {
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentTimelineQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

/** The detail view listens for this to open the post-mortem section. */
export const OPEN_POSTMORTEM_EVENT = "incident:open-postmortem";

export function ResolveSreIncidentDialog({
  incidentId,
  defaultSummary = "",
  open: controlledOpen,
  onOpenChange,
}: {
  incidentId: string;
  /** Pre-fills the summary, for example from the AI root cause. The user still confirms it. */
  defaultSummary?: string;
  /** Controlled mode: the caller owns the open state and supplies its own trigger. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const commentId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [comment, setComment] = useState(defaultSummary.slice(0, 2000));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const resolve = () => {
    if (pending || !comment.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/sre/incidents/${incidentId}/resolve`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(projectId ? { "x-project-id": projectId } : {}),
            },
            body: JSON.stringify({ comment: comment.trim() }),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          success?: boolean;
          message?: string;
          error?: string;
        } | null;
        if (!response.ok || !body?.success) {
          setError(
            body?.error ?? "Could not resolve the incident. Please try again.",
          );
          return;
        }
        setOpen(false);
        setComment(defaultSummary.slice(0, 2000));
        toast.success(body.message ?? "Incident resolved", {
          description: "You can generate a post-mortem draft from the incident timeline.",
          action: {
            label: "Post-mortem",
            onClick: () => window.dispatchEvent(new Event(OPEN_POSTMORTEM_EVENT)),
          },
        });
        await Promise.allSettled(
          [
            getSreIncidentDetailQueryKey(projectId, incidentId),
            getSreIncidentTimelineQueryKey(projectId, incidentId),
            getSreIncidentsQueryKey(projectId),
            getSreIncidentAnalyticsQueryKey(projectId),
          ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
      } catch {
        setError(
          "Could not confirm resolution. Refresh the incident before trying again.",
        );
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!pending) {
          setOpen(value);
          setError(null);
        }
      }}
    >
      {controlledOpen === undefined && (
        <DialogTrigger asChild>
          <Button size="sm">
            <Check className="h-4 w-4" />
            Resolve incident
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve incident</DialogTitle>
          <DialogDescription>
            A resolution summary is required. It is saved on the incident and
            shared with the team. Resolving records your decision; it does not
            apply a fix or run a check.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={commentId}>What confirmed recovery?</Label>
          <Textarea
            id={commentId}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={2000}
            disabled={pending}
            placeholder="Describe the fix and the checks you used to verify recovery."
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={resolve} disabled={pending || !comment.trim()}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}Resolve
            incident
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
