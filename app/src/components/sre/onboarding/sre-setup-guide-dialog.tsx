"use client";

import Link from "next/link";
import { Check, Info, ListChecks } from "lucide-react";

import type { SreOnboardingStatus } from "@/actions/sre-onboarding";
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
import { TableBadge } from "@/components/ui/table-badge";

type SreSetupGuideDialogProps = {
  status: SreOnboardingStatus | null;
};

export function SreSetupGuideDialog({ status }: SreSetupGuideDialogProps) {
  const steps = [
    {
      label: "Add a service",
      description: "Define the service, owner, environment, and repository.",
      complete: Boolean(status?.services),
      href: "/org-admin?tab=services",
      action: "Open Services",
    },
    {
      label: "Add a connector",
      description: "Connect a read-only source and limit its service scope.",
      complete: Boolean(status?.connectors),
      href: "/org-admin?tab=integrations",
      action: "Open Integrations",
    },
    {
      label: "Add a diagnostic recipe",
      description: "Save a bounded query for a common investigation check.",
      complete: Boolean(status?.diagnosticRecipes),
      href: "/org-admin?tab=diagnostic-recipes",
      action: "Open Recipes",
    },
  ];
  const completedSteps = status?.completedRequiredSteps ?? 0;
  const requiredSteps = status?.requiredSteps ?? steps.length;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full sm:w-auto">
          <ListChecks className="mr-2 h-4 w-4" />
          Setup guide
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>AI SRE setup</DialogTitle>
            <TableBadge
              tone={completedSteps === requiredSteps ? "success" : "info"}
            >
              {completedSteps}/{requiredSteps} complete
            </TableBadge>
          </div>
          <DialogDescription>
            Complete these steps before running connector-backed investigations.
          </DialogDescription>
        </DialogHeader>

        <ol className="divide-y px-6">
          {steps.map((step, index) => (
            <li key={step.label} className="flex gap-3 py-4">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-xs font-semibold"
                aria-hidden="true"
              >
                {step.complete ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{step.label}</p>
                      {step.complete && (
                        <TableBadge tone="success" compact>
                          Complete
                        </TableBadge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                  <Button
                    asChild
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0 self-start"
                  >
                    <Link href={step.href}>{step.action}</Link>
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5" />
            Private Agents are optional for supported private-network sources.
          </p>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
