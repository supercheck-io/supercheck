"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Clock,
  Download,
  FileText,
  GitBranch,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SreMessageContent } from "@/components/sre/sre-message-content";
import { useProjectContext } from "@/hooks/use-project-context";
import { getSreIncidentDetailQueryKey } from "@/lib/sre/query-keys";
import { POSTMORTEM_SECTIONS, postmortemToMarkdown } from "@/lib/sre/postmortem-format";
import type { SrePostmortem } from "@/db/schema";
import { formatAgo, useNow } from "@/components/sre/incidents/incident-age";
import { IconTile, SectionTitle, toneButton, type IconTone } from "@/components/sre/incidents/incident-ui";

const TEXT_SECTIONS = POSTMORTEM_SECTIONS.filter(({ key }) => key !== "follow_ups");

// Same section icons and tones as the rest of the incident page.
const SECTION_VISUAL: Record<string, { icon: LucideIcon; tone: IconTone; hint: string }> = {
  summary: { icon: FileText, tone: "violet", hint: "What happened, in two or three sentences." },
  impact: { icon: Activity, tone: "rose", hint: "Who was affected, for how long, and how badly." },
  timeline: { icon: Clock, tone: "blue", hint: "- 6 Oct 2026, 14:58 UTC: What happened" },
  root_cause: { icon: Search, tone: "amber", hint: "Why it happened, as confirmed by the team." },
  contributing_factors: { icon: GitBranch, tone: "indigo", hint: "What made it worse or slower to fix." },
  follow_ups: { icon: ListChecks, tone: "emerald", hint: "" },
};

function parseFollowUps(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    // No length cap here: saving an edit elsewhere must not cut a long stored follow-up.
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
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

function EmptySection() {
  return <p className="text-sm italic text-muted-foreground">Not written yet.</p>;
}

/** Post-mortem for a resolved incident: read as a document, edited in place, exportable as Markdown. */
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
  const now = useNow();
  // `saved` is what Cancel goes back to; `sections` and `followUps` are the form.
  const [saved, setSaved] = useState<SrePostmortem | null>(postmortem);
  const [sections, setSections] = useState<Record<string, string>>({ ...(postmortem?.sections ?? {}) });
  const [followUps, setFollowUps] = useState<string[]>(parseFollowUps(postmortem?.sections.follow_ups));
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [confirmReplace, setConfirmReplace] = useState(false);
  // Entering or leaving the editor unmounts the focused button; move focus somewhere sensible.
  const heading = useRef<HTMLHeadingElement>(null);
  const switched = useRef(false);
  // `saved` too: the first draft replaces the empty state (and its button) without leaving edit mode.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    if (editing) document.getElementById("postmortem-summary")?.focus();
    else heading.current?.focus();
  }, [editing, saved]);

  // Follow a newer stored version (another tab or person) without remounting, so focus stays put;
  // while editing, keep the person's text: their Save or Cancel decides.
  const [seenAt, setSeenAt] = useState(postmortem?.updatedAt);
  if (postmortem && postmortem.updatedAt !== seenAt) {
    setSeenAt(postmortem.updatedAt);
    if (!editing && postmortem.updatedAt !== saved?.updatedAt) {
      setSaved(postmortem);
      setSections({ ...postmortem.sections });
      setFollowUps(parseFollowUps(postmortem.sections.follow_ups));
    }
  }
  const switchMode = (next: boolean) => {
    switched.current = true;
    setEditing(next);
  };

  const reset = (stored: SrePostmortem | null) => {
    setSections({ ...(stored?.sections ?? {}) });
    setFollowUps(parseFollowUps(stored?.sections.follow_ups));
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: getSreIncidentDetailQueryKey(projectId, incidentId) });

  const generate = () => {
    setConfirmReplace(false);
    startTransition(async () => {
      const result = await generateSrePostmortem({ incidentId }).catch(() => null);
      if (!result?.success) {
        toast.error(result?.error ?? "Could not generate the draft");
        return;
      }
      setSaved(result.postmortem);
      reset(result.postmortem);
      switched.current = true;
      setEditing(false);
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
      setSaved(result.postmortem);
      reset(result.postmortem);
      switchMode(false);
      toast.success("Post-mortem saved");
      await refresh();
    });

  const cancel = () => {
    reset(saved);
    switchMode(false);
  };

  // While editing, export what is on screen (unsaved edits included); otherwise the stored text as is.
  const exportMarkdown = () =>
    download(
      `postmortem-incident-${incidentNumber}.md`,
      postmortemToMarkdown({ incidentNumber, title, sections: editing || !saved ? currentSections() : saved.sections }),
    );

  const meta = saved
    ? [
        saved.generatedAt ? `Draft generated ${formatAgo(saved.generatedAt, now)}` : null,
        saved.updatedAt && saved.updatedAt !== saved.generatedAt ? `Saved ${formatAgo(saved.updatedAt, now)}` : null,
      ].filter(Boolean).join(" · ")
    : "";

  if (!saved) {
    return (
      <Card id="incident-postmortem" data-testid="postmortem-card" className="items-center gap-4 px-6 py-12 text-center shadow-none">
        <IconTile icon={FileText} tone="violet" className="size-10 rounded-lg [&_svg]:size-5" />
        <div className="max-w-md space-y-1">
          <h2 className="text-sm font-semibold">No post-mortem yet</h2>
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "Generate a blameless draft from the activity, investigation and resolution, then review and edit it. If AI is unavailable you get a template filled from the incident record."
              : "No post-mortem has been written for this incident."}
          </p>
        </div>
        {canEdit && (
          <Button type="button" size="sm" onClick={generate} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            Generate post-mortem draft
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card id="incident-postmortem" data-testid="postmortem-card" className="scroll-mt-4 gap-0 py-0 shadow-none">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 ref={heading} tabIndex={-1} className="text-sm font-semibold focus-visible:outline-none">
            {editing ? "Editing post-mortem" : "Post-mortem"}
          </h2>
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {meta ? `${meta}. ` : ""}Blameless draft; review it before sharing.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canEdit && !editing && (
            <>
              <Button type="button" variant="outline" size="sm" className={toneButton("violet")} onClick={() => setConfirmReplace(true)} disabled={pending}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                Regenerate draft
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => switchMode(true)} disabled={pending}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit
              </Button>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="outline" size="icon" className={`h-8 w-8 ${toneButton("sky")}`} aria-label="Export Markdown" onClick={exportMarkdown}>
                <Download className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{editing ? "Export Markdown, including unsaved edits" : "Export Markdown"}</TooltipContent>
          </Tooltip>
        </div>
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

      {editing ? (
        <form
          className="space-y-5 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {/* Locked while saving: the saved response replaces the form, so later keystrokes would be lost. */}
          <fieldset disabled={pending} className="min-w-0 space-y-5">
          {TEXT_SECTIONS.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`postmortem-${key}`} className="flex items-center gap-2">
                <IconTile icon={SECTION_VISUAL[key]!.icon} tone={SECTION_VISUAL[key]!.tone} />
                {label}
              </Label>
              <Textarea
                id={`postmortem-${key}`}
                value={sections[key] ?? ""}
                maxLength={4000}
                placeholder={SECTION_VISUAL[key]!.hint}
                aria-describedby={key === "timeline" ? "postmortem-timeline-help" : undefined}
                className={key === "timeline" ? "min-h-32 max-h-[28rem] font-mono text-xs md:text-xs" : "min-h-20 max-h-80"}
                onChange={(event) => setSections((current) => ({ ...current, [key]: event.target.value }))}
              />
              {key === "timeline" && (
                <p id="postmortem-timeline-help" className="text-xs text-muted-foreground">
                  One line per moment, oldest first: &quot;- 6 Oct 2026, 14:58 UTC: What happened&quot;.
                </p>
              )}
            </div>
          ))}
          <fieldset className="space-y-2">
            <legend className="mb-2 flex items-center gap-2 text-sm font-medium">
              <IconTile icon={SECTION_VISUAL.follow_ups!.icon} tone={SECTION_VISUAL.follow_ups!.tone} />
              Follow-ups
            </legend>
            {followUps.length === 0 && <p className="text-sm text-muted-foreground">No follow-ups yet.</p>}
            <ul className="space-y-2">
              {followUps.map((item, index) => (
                <li key={index} className="flex items-center gap-2">
                  <Input
                    aria-label={`Follow-up ${index + 1}`}
                    value={item}
                    maxLength={300}
                    placeholder="Action, owner and due date"
                    onChange={(event) =>
                      setFollowUps((current) => current.map((value, i) => (i === index ? event.target.value : value)))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove follow-up ${index + 1}`}
                    onClick={() => setFollowUps((current) => current.filter((_, i) => i !== index))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            {followUps.length < 20 && (
              <Button type="button" variant="outline" size="sm" className={toneButton("sky")} onClick={() => setFollowUps((current) => [...current, ""])}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add follow-up
              </Button>
            )}
          </fieldset>
          </fieldset>
          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save post-mortem
            </Button>
          </div>
        </form>
      ) : (
        <div className="divide-y">
          {TEXT_SECTIONS.map(({ key, label }) => {
            const text = saved.sections[key]?.trim();
            return (
              <section key={key} aria-labelledby={`postmortem-${key}-title`} className="space-y-2 px-4 py-4">
                <SectionTitle id={`postmortem-${key}-title`} icon={SECTION_VISUAL[key]!.icon} tone={SECTION_VISUAL[key]!.tone}>
                  {label}
                </SectionTitle>
                {text ? (
                  <div className="break-words text-sm leading-relaxed">
                    <SreMessageContent content={text} />
                  </div>
                ) : (
                  <EmptySection />
                )}
              </section>
            );
          })}
          <section aria-labelledby="postmortem-follow_ups-title" className="space-y-2 px-4 py-4">
            <SectionTitle
              id="postmortem-follow_ups-title"
              icon={SECTION_VISUAL.follow_ups!.icon}
              tone={SECTION_VISUAL.follow_ups!.tone}
              count={parseFollowUps(saved.sections.follow_ups).length || undefined}
            >
              Follow-ups
            </SectionTitle>
            {/* The stored text as written; the editor's one-line-per-item list is only for editing. */}
            {saved.sections.follow_ups?.trim() ? (
              <div className="break-words text-sm leading-relaxed">
                <SreMessageContent content={saved.sections.follow_ups.trim()} />
              </div>
            ) : (
              <EmptySection />
            )}
          </section>
        </div>
      )}
    </Card>
  );
}
