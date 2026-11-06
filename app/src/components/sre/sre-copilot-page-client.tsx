"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, ShieldCheck } from "lucide-react";

import type { SreCopilotChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { Button } from "@/components/ui/button";
import {
  SUBSCRIPTION_STATUS_QUERY_KEY,
  fetchSubscriptionStatus,
} from "@/components/subscription-guard";
import { SreAiConsole } from "@/components/sre/sre-ai-console";
import { useProjectContext } from "@/hooks/use-project-context";
import { useSreCopilotHistories } from "@/hooks/use-sre";
import { canInvestigateWithSreCopilot } from "@/lib/rbac/permissions-client";
import { getSreCopilotHistoriesQueryKey } from "@/lib/sre/query-keys";

export function SreCopilotPageClient({
  initialIncidentId = null,
}: {
  initialIncidentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const canInvestigate = canInvestigateWithSreCopilot(currentProject?.userRole);
  const query = useSreCopilotHistories({ enabled: canInvestigate, incidentId: initialIncidentId });
  // Copilot chat needs a paid plan (the server answers 402 to a trial); say so before the first send.
  // Self-hosted reports an active plan. A failed status read never blocks: the server still decides.
  const { data: subscription } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    staleTime: 60_000,
  });
  const needsPaidPlan = canInvestigate && !!subscription && !subscription.isActive;
  const updateCachedHistories = useCallback(
    (histories: SreCopilotChatHistory[]) => {
      queryClient.setQueryData(getSreCopilotHistoriesQueryKey(projectId, initialIncidentId), {
        success: true,
        histories,
      });
    },
    [initialIncidentId, projectId, queryClient],
  );
  const refreshHistories = useCallback(() => {
    // Mark stale and refetch so a chat abandoned mid-stream (which never fired
    // onFinish) shows up when the sheet opens. Invalidation does not refetch
    // per render, so keeping the sheet open cannot start a request loop.
    void queryClient.invalidateQueries({
      queryKey: getSreCopilotHistoriesQueryKey(projectId),
      refetchType: "active",
    });
  }, [projectId, queryClient]);

  if (needsPaidPlan) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <DashboardEmptyState
          icon={<Sparkles className="h-10 w-10" />}
          title="Copilot needs a paid plan"
          description="Copilot chat is not part of the free trial. Subscribe to ask questions about incidents and evidence."
          action={
            <Button asChild>
              <Link href="/billing">View plans</Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (!canInvestigate) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <DashboardEmptyState
          icon={<ShieldCheck className="h-10 w-10" />}
          title="Read-only access"
          description="Copilot chat requires investigation permission. You can still review incidents, evidence, and saved reports in this project."
        />
      </div>
    );
  }

  if (!query.data) {
    if (query.isPending) {
      return (
        <SupercheckLoading className="h-full" message="Loading Copilot..." />
      );
    }

    return (
      <SreAiConsole
        key={`${projectId}:${initialIncidentId ?? "project"}`}
        initialIncidentId={initialIncidentId}
        loadError={
          query.error instanceof Error
            ? query.error.message
            : "Failed to load Copilot history"
        }
      />
    );
  }

  return (
    <SreAiConsole
      key={`${projectId}:${initialIncidentId ?? "project"}`}
      initialIncidentId={initialIncidentId}
      initialHistories={query.data.histories}
      loadError={query.data.success ? null : query.data.error}
      onHistoriesChange={query.data.success ? updateCachedHistories : undefined}
      onRequestHistoryRefresh={
        query.data.success ? refreshHistories : undefined
      }
    />
  );
}
