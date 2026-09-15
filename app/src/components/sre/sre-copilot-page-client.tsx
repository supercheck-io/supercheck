"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { SreAiConsole } from "@/components/sre/sre-ai-console";
import { useProjectContext } from "@/hooks/use-project-context";
import { useSreCopilotHistories } from "@/hooks/use-sre";
import { canInvestigateWithSreCopilot } from "@/lib/rbac/permissions-client";
import { getSreCopilotHistoriesQueryKey } from "@/lib/sre/query-keys";

export function SreCopilotPageClient() {
  const queryClient = useQueryClient();
  const { projectId, currentProject } = useProjectContext();
  const canInvestigate = canInvestigateWithSreCopilot(currentProject?.userRole);
  const query = useSreCopilotHistories({ enabled: canInvestigate });
  const updateCachedHistories = useCallback(
    (histories: SreStandaloneChatHistory[]) => {
      queryClient.setQueryData(getSreCopilotHistoriesQueryKey(projectId), {
        success: true,
        histories,
      });
    },
    [projectId, queryClient],
  );

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
      initialHistories={query.data.histories}
      loadError={query.data.success ? null : query.data.error}
      onHistoriesChange={query.data.success ? updateCachedHistories : undefined}
    />
  );
}
