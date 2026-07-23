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

export const SRE_COMMAND_SHORTCUTS = [
  {
    label: "/health",
    description:
      "Summarize available health signals. Without incident evidence, Copilot explains what to check.",
    prompt:
      "/health Inspect current system health and summarize the most important signals as tables or charts when data is available.",
  },
  {
    label: "/investigate",
    description:
      "Triage the selected incident or service using stored and permitted live evidence.",
    prompt:
      "/investigate Help me investigate the currently selected service or incident using only read-only evidence and verification steps.",
  },
  {
    label: "/evidence",
    description:
      "Review supporting evidence, confidence, gaps, and the next safe checks.",
    prompt:
      "/evidence Show the strongest evidence, gaps, and next read-only checks. Use inline charts for numeric series when possible.",
  },
  {
    label: "/verify",
    description:
      "Build a concrete read-only checklist to validate a hypothesis before action.",
    prompt:
      "/verify Build a read-only verification plan with concrete checks I can run before taking action.",
  },
] as const;

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
            Ask read-only questions about incidents, services, evidence, and
            verification. Copilot never changes your systems.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <section aria-labelledby="copilot-help-commands">
            <h3
              id="copilot-help-commands"
              className="mb-2 font-medium text-foreground"
            >
              Commands
            </h3>
            <dl className="space-y-3">
              {SRE_COMMAND_SHORTCUTS.map((shortcut) => (
                <div
                  key={shortcut.label}
                  className="grid gap-1 sm:grid-cols-[6.5rem_1fr]"
                >
                  <dt>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {shortcut.label}
                    </code>
                  </dt>
                  <dd className="text-muted-foreground">
                    {shortcut.description}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="copilot-help-context">
            <h3
              id="copilot-help-context"
              className="mb-2 font-medium text-foreground"
            >
              Context and files
            </h3>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                <strong className="text-foreground">@ context</strong> adds an
                incident, service, or recent-deploy label to your question. A
                label is not treated as verified until evidence confirms it.
              </li>
              <li>
                Drop text, log, JSON, CSV, or Markdown files to provide local
                context. Files are read as evidence and cannot trigger actions.
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
                Standalone chat uses your question and attached files. It does
                not automatically inspect an incident or Kubernetes cluster.
              </li>
              <li>
                Incident-scoped chat can use stored Supercheck evidence and
                enabled, service-scoped connectors when your role permits it.
              </li>
              <li>
                If evidence is unavailable, Copilot should say so and provide a
                verification plan instead of presenting unverified values.
              </li>
            </ul>
          </section>

          <div className="rounded-lg border bg-muted/30 p-3 text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <ShieldCheck className="h-4 w-4" />
              Read-only by design
            </div>
            Copilot can summarize, investigate, and plan checks. It cannot
            restart workloads, edit configuration, delete data, or remediate an
            incident.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
