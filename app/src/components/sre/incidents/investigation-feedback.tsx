"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";

import { submitSreInvestigationFeedback } from "@/actions/sre-investigation-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey } from "@/lib/sre/query-keys";
import { cn } from "@/lib/utils";

type Verdict = "right" | "wrong";

/**
 * Right/Wrong for a whole investigation (hypothesisKey null) or one hypothesis,
 * with an optional one-line note. The note is sent to future runs as hints.
 */
export function InvestigationFeedback({
  incidentId,
  investigationRunId,
  hypothesisKey = null,
  initial = null,
  label,
  compact = false,
}: {
  incidentId: string;
  investigationRunId: string;
  hypothesisKey?: string | null;
  initial?: { verdict: Verdict; note: string | null } | null;
  label: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [saved, setSaved] = useState<{ verdict: Verdict; note: string | null } | null>(initial);
  const [draft, setDraft] = useState<Verdict | null>(null);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const noteId = `feedback-note-${investigationRunId}-${hypothesisKey ?? "run"}`;

  const save = () => {
    if (!draft) return;
    startTransition(async () => {
      const result = await submitSreInvestigationFeedback({
        investigationRunId,
        hypothesisKey,
        verdict: draft,
        note: note.trim() || null,
      }).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "Could not save feedback");
        return;
      }
      setSaved({ verdict: draft, note: note.trim() || null });
      setDraft(null);
      setNote("");
      toast.success("Thanks, feedback saved");
      await queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incidentId) });
    });
  };

  const active = draft ?? saved?.verdict ?? null;
  const button = (verdict: Verdict, Icon: typeof ThumbsUp, text: string) => {
    const control = (
    <Button
      type="button"
      variant={active === verdict ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={active === verdict}
      aria-label={`${text}: ${label}`}
      className={cn("h-7 gap-1 px-2 text-xs", compact && "w-7 px-0", active === verdict && "ring-1 ring-border")}
      onClick={() => setDraft(verdict)}
      disabled={pending}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {!compact && text}
    </Button>
    );
    if (!compact) return control;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{verdict === "right" ? "The AI got this right" : "The AI got this wrong"}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className={cn("space-y-2", compact && "ml-auto text-xs", compact && draft && "basis-full")}>
      <div
        className={cn("flex flex-wrap items-center gap-1", compact && "justify-end")}
        role="group"
        aria-label={`Feedback on ${label}`}
      >
        {button("right", ThumbsUp, "Right")}
        {button("wrong", ThumbsDown, "Wrong")}
        {saved && !draft && !compact && (
          <span className="text-xs text-muted-foreground" role="status">
            You marked this {saved.verdict}
            {saved.note ? `: ${saved.note}` : ""}
          </span>
        )}
      </div>
      {draft && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <label htmlFor={noteId} className="sr-only">
            Optional one-line note
          </label>
          <Input
            id={noteId}
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
            placeholder={draft === "wrong" ? "What was it instead? (optional)" : "Anything to add? (optional)"}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
