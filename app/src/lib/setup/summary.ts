import "server-only";
import { isAIProviderConfigured } from "@/lib/ai/ai-provider";
import { deriveChecklist, type SetupCounts } from "@/lib/setup/checklist";
import { resolveSetupFeatures } from "@/lib/setup/features";
import { getChecklistCounts, getSetupState } from "@/lib/setup/setup-state";
import type { SetupSummary } from "@/lib/setup/types";

export const projectIsEmpty = (c: SetupCounts) => c.monitors + c.tests + c.jobs + c.statusPages === 0;

/** The sidebar's setup badge: state and checklist counts only. The caller has checked project view access. */
export async function getSetupSummary(organizationId: string, projectId: string, userId: string): Promise<SetupSummary> {
  const [state, counts] = await Promise.all([
    getSetupState(organizationId, projectId, userId),
    getChecklistCounts(organizationId, projectId),
  ]);
  const checklist = deriveChecklist(counts, resolveSetupFeatures({ aiConfigured: isAIProviderConfigured() }), state.statusPageOptOut);
  return { status: state.status, done: checklist.done, total: checklist.total, projectEmpty: projectIsEmpty(counts) };
}
