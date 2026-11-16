"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconChip } from "@/components/ui/icon-chip";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { TableBadge } from "@/components/ui/table-badge";
import { useAppConfig } from "@/hooks/use-app-config";
import { useProjectContextSafe } from "@/hooks/use-project-context";
import { getProjectSetupQueryKey, setProjectSetupData, updateProjectSetup, useProjectSetup } from "@/hooks/use-project-setup";
import { NAV } from "@/lib/nav-areas";
import type { Checklist } from "@/lib/setup/checklist";
import { CHECKLIST_ICONS } from "./setup-checklist";
import type { ProjectSetupStatus } from "@/db/schema/project-setup";

interface GettingStartedCardProps {
  checklist: Checklist;
  status: ProjectSetupStatus;
  canEdit: boolean;
  projectId: string;
  onDismiss?: () => void;
  dismissing?: boolean;
}

export function GettingStartedCard({ checklist, status, canEdit, projectId, onDismiss, dismissing }: GettingStartedCardProps) {
  const { done, total } = checklist;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const started = status === "in_progress" || done > 0;
  return (
    <Card className="shadow-sm" data-testid="getting-started-card">
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <IconChip icon={NAV.projectSetup.icon} tone={NAV.projectSetup.tone} size="md" className="mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold">Getting started</h2>
              <p className="text-sm text-muted-foreground">
                {done} of {total} done
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <Button asChild size="sm">
                <Link href={`/setup?project=${projectId}`}>{started ? "Continue" : "Start setup"}</Link>
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link href={`/setup?project=${projectId}`}>View checklist</Link>
              </Button>
            )}
            {canEdit && onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss} disabled={dismissing}>
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
        <Progress value={percent} aria-label={`Setup progress, ${done} of ${total} done`} />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {checklist.items.slice(0, 6).map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-accent"
              >
                {CHECKLIST_ICONS[item.key] ? <IconChip icon={CHECKLIST_ICONS[item.key].icon} tone={CHECKLIST_ICONS[item.key].tone} size="sm" /> : null}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.done ? <TableBadge tone="success" compact aria-hidden="true">Done</TableBadge> : null}
                <span className="sr-only">{item.done ? "(done)" : "(not done)"}</span>
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard slot (D15). Same rule as the sidebar: the card shows while setup is in progress, or not started on
 * an empty project (the setup response's `projectEmpty`), so existing projects are not nagged after an upgrade.
 * Anything else, including an error or the flag being off, shows `fallback`. `dashboardHasData` only skips the skeleton.
 */
export function DashboardGettingStarted({ fallback, dashboardHasData = false }: { fallback: ReactNode; dashboardHasData?: boolean }) {
  const { setupFeatures } = useAppConfig();
  const project = useProjectContextSafe()?.currentProject ?? null;
  const queryClient = useQueryClient();
  const [dismissing, setDismissing] = useState(false);
  const query = useProjectSetup(setupFeatures.setup ? project?.id : null);

  if (!setupFeatures.setup || !project) return <>{fallback}</>;
  if (query.isPending) return dashboardHasData ? <>{fallback}</> : <Skeleton className="m-4 h-48" data-testid="getting-started-skeleton" />;
  if (query.isError || !query.data) return <>{fallback}</>;
  const { state, checklist, permissions, projectEmpty } = query.data;
  if (!(state.status === "in_progress" || (state.status === "not_started" && projectEmpty))) return <>{fallback}</>;

  const dismiss = async () => {
    // A second click while the first is in flight would send a stale expectedUpdatedAt and show a false error.
    if (dismissing) return;
    setDismissing(true);
    try {
      const res = await updateProjectSetup(project.id, { expectedUpdatedAt: state.updatedAt, status: "dismissed" });
      setProjectSetupData(queryClient, project.id, res);
    } catch {
      // A 409 means the state moved on; refetch so the retry carries the current updatedAt.
      void queryClient.invalidateQueries({ queryKey: getProjectSetupQueryKey(project.id) });
      toast.error("Could not dismiss. Try again.");
    } finally {
      setDismissing(false);
    }
  };

  return (
    <GettingStartedCard
      checklist={checklist}
      status={state.status}
      canEdit={permissions.canEdit}
      projectId={project.id}
      onDismiss={dismiss}
      dismissing={dismissing}
    />
  );
}
