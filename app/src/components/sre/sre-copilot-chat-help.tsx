"use client";

import { CircleHelp, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function CopilotChatHelp() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          aria-label="Open Copilot chat help"
        >
          <CircleHelp className="h-4 w-4" />
          <span className="hidden sm:inline">Chat help</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Using Copilot chat</DialogTitle>
          <DialogDescription>
            Ask about symptoms, incident evidence, and the next diagnostic
            checks. Copilot never changes your systems.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <section aria-labelledby="copilot-help-ask">
            <h3
              id="copilot-help-ask"
              className="mb-2 font-medium text-foreground"
            >
              Good questions to ask
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>What facts support the leading hypothesis?</li>
              <li>Which evidence is missing or contradictory?</li>
              <li>What read-only check should I run next, and why?</li>
            </ul>
          </section>

          <section aria-labelledby="copilot-help-sources">
            <h3
              id="copilot-help-sources"
              className="mb-2 font-medium text-foreground"
            >
              What Copilot can use
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                Standalone chat uses only your question and text you paste into
                the composer. It does not automatically inspect an incident or
                connected system.
              </li>
              <li>
                Incident-scoped chat can inspect stored evidence for the open
                incident.
              </li>
              <li>
                <strong className="text-foreground">Live sources</strong> is off
                by default. Turn it on only when the incident needs fresh data
                from configured read-only connectors.
              </li>
            </ul>
          </section>

          <section aria-labelledby="copilot-help-evidence">
            <h3
              id="copilot-help-evidence"
              className="mb-2 font-medium text-foreground"
            >
              Where answers come from
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                Copilot should distinguish verified facts, user-provided
                context, assumptions, and missing evidence.
              </li>
              <li>
                If evidence is unavailable, it should say so and suggest the
                next safe checks instead of presenting invented values.
              </li>
            </ul>
          </section>

          <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-4 w-4" />
              Read-only by design
            </div>
            Copilot can summarize evidence, evaluate hypotheses, and suggest
            checks. It cannot restart workloads, edit configuration, delete
            data, or remediate an incident.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
