"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { generateSrePostmortem, saveSrePostmortem } from "@/actions/sre-postmortem";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey } from "@/lib/sre/query-keys";
import { POSTMORTEM_SECTIONS, postmortemToMarkdown } from "@/lib/sre/postmortem-format";
import type { SrePostmortem } from "@/db/schema";

const TEXT_SECTIONS = POSTMORTEM_SECTIONS.filter(({ key }) => key !== "follow_ups");

function parseFollowUps(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim().slice(0, 300))
    .filter(Boolean);
}
const serializeFollowUps = (items: string[]) =>
  items.map((item) => item.trim()).filter(Boolean).map((item) => `- ${item}`).join("\n");

function download(filename: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Editable post-mortem for a resolved incident, exportable as Markdown. */
export function PostmortemCard({
  incidentId,
  incidentNumber,
  title,
  postmortem,
  canEdit,
}: {
  incidentId: string;
  incidentNumber: number;
  title: string;
  postmortem: SrePostmortem | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const [sections, setSections] = useState<Record<string, string>>({ ...(postmortem?.sections ?? {}) });
  const [followUps, setFollowUps] = useState<string[]>(parseFollowUps(postmortem?.sections.follow_ups));
  const [pending, startTransition] = useTransition();
  const [hasDraft, setHasDraft] = useState(Boolean(postmortem));

  const apply = (stored: SrePostmortem) => {
    setSections({ ...stored.sections });
    setFollowUps(parseFollowUps(stored.sections.follow_ups));
    setHasDraft(true);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incidentId) });

  const [confirmReplace, setConfirmReplace] = useState(false);

  const generate = () => {
    setConfirmReplace(false);
    startTransition(async () => {
      const result = await generateSrePostmortem({ incidentId }).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "Could not generate the draft");
        return;
      }
      apply(result.postmortem);
      toast.success(
        result.source === "ai" ? "Draft generated. Review and edit before sharing." : "Draft created from the incident record. AI drafting was unavailable.",
      );
      await refresh();
    });
  };

  const currentSections = () => ({
    summary: sections.summary ?? "",
    impact: sections.impact ?? "",
    timeline: sections.timeline ?? "",
    root_cause: sections.root_cause ?? "",
    contributing_factors: sections.contributing_factors ?? "",
    follow_ups: serializeFollowUps(followUps),
  });

  const save = () =>
    startTransition(async () => {
      const result = await saveSrePostmortem({ incidentId, sections: currentSections() }).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "Could not save the post-mortem");
        return;
      }
      toast.success("Post-mortem saved");
      await refresh();
    });

  const exportMarkdown = () =>
    download(
      `postmortem-incident-${incidentNumber}.md`,
      postmortemToMarkdown({ incidentNumber, title, sections: currentSections() }),
    );

  return (
    <Card id="incident-postmortem" className="scroll-mt-4" data-testid="postmortem-card">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Post-mortem
          </CardTitle>
          <CardDescription>
            A blameless write-up built from the timeline, resolution and investigation. Review and edit before sharing.
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasDraft && (
            <Button type="button" variant="outline" size="sm" onClick={exportMarkdown}>
              <Download className="h-4 w-4" aria-hidden="true" />
              Export Markdown
            </Button>
          )}
          {canEdit && (
            <Button type="button" variant={hasDraft ? "outline" : "default"} size="sm" onClick={hasDraft ? () => setConfirmReplace(true) : generate} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
              {hasDraft ? "Regenerate draft" : "Generate post-mortem draft"}
            </Button>
          )}
        </div>
        <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace the post-mortem?</AlertDialogTitle>
              <AlertDialogDescription>
                A new draft replaces the current post-mortem. Your edits will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={generate}>Replace draft</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardHeader>
      <CardContent>
        {!hasDraft ? (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "No post-mortem yet. Generate a draft to start; if AI is unavailable you get a template filled from the incident record."
              : "No post-mortem has been written for this incident."}
          </p>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (canEdit) save();
            }}
          >
            {TEXT_SECTIONS.map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`postmortem-${key}`}>{label}</Label>
                <Textarea
                  id={`postmortem-${key}`}
                  value={sections[key] ?? ""}
                  maxLength={4000}
                  rows={key === "summary" || key === "timeline" ? 5 : 3}
                  readOnly={!canEdit}
                  onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Follow-ups</legend>
              {followUps.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups yet.</p>}
              <ul className="space-y-2">
                {followUps.map((item, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`Follow-up ${index + 1}`}
                      value={item}
                      maxLength={300}
                      readOnly={!canEdit}
                      onChange={(event) =>
                        setFollowUps((current) => current.map((value, i) => (i === index ? event.target.value : value)))
                      }
                    />
                    {canEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove follow-up ${index + 1}`}
                        onClick={() => setFollowUps((current) => current.filter((_, i) => i !== index))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && followUps.length < 20 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setFollowUps((current) => [...current, ""])}>
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add follow-up
                </Button>
              )}
            </fieldset>
            {canEdit && (
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save post-mortem
              </Button>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
