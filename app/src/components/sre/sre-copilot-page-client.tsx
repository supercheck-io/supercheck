"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { SreStandaloneChatHistory } from "@/actions/sre-ai";
import { SupercheckLoading } from "@/components/shared/supercheck-loading";
import { SreAiConsole } from "@/components/sre/sre-ai-console";
import { useProjectContext } from "@/hooks/use-project-context";
import { useSreCopilotHistories } from "@/hooks/use-sre";
import { getSreCopilotHistoriesQueryKey } from "@/lib/sre/query-keys";

export function SreCopilotPageClient() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  const query = useSreCopilotHistories();
  const updateCachedHistories = useCallback(
    (histories: SreStandaloneChatHistory[]) => {
      queryClient.setQueryData(getSreCopilotHistoriesQueryKey(projectId), {
        success: true,
        histories,
      });
    },
    [projectId, queryClient],
  );

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
