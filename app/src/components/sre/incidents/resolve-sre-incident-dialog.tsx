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
  getSreEvidenceGraphQueryKey,
  getSreIncidentAnalyticsQueryKey,
  getSreIncidentDetailQueryKey,
  getSreIncidentsQueryKey,
} from "@/lib/sre/query-keys";

export function ResolveSreIncidentDialog({
  incidentId,
}: {
  incidentId: string;
}) {
  const { projectId } = useProjectContext();
  const queryClient = useQueryClient();
  const commentId = useId();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
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
        setComment("");
        toast.success(body.message ?? "Incident resolved");
        await Promise.allSettled(
          [
            getSreIncidentDetailQueryKey(projectId, incidentId),
            getSreIncidentsQueryKey(projectId),
            getSreIncidentAnalyticsQueryKey(projectId),
            getSreEvidenceGraphQueryKey(projectId),
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
      <DialogTrigger asChild>
        <Button size="sm">
          <Check className="h-4 w-4" />
          Resolve incident
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve incident</DialogTitle>
          <DialogDescription>
            Confirm recovery with your tests or monitors first. Resolving
            records your decision; it does not apply a fix or run a check.
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
