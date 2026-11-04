import { and, eq } from "drizzle-orm";

import { sreIncidents } from "@/db/schema";
import { validateAIConfiguration } from "@/lib/ai/ai-provider";
import { createLogger } from "@/lib/logger/index";
import { assertCanStartSreInvestigation } from "@/lib/sre/investigation-billing";
import { getNotificationPolicy } from "@/lib/sre/notification-policy";
import { sreDailyTokenLimitResponse } from "@/lib/sre/sre-daily-token-limit";
import { isSreEnabled } from "@/sre/lib/feature-gates";
import { completeSreIncidentInvestigation, startSreIncidentInvestigation } from "@/sre/lib/investigation-runner";
import { runSreIncidentTriage } from "@/sre/lib/triage-runner";
import { db } from "@/utils/db";

const logger = createLogger({ module: "sre-auto-investigate" }) as {
  error: (data: unknown, message?: string) => void;
};

export type AutoInvestigateInput = {
  organizationId: string;
  projectId: string;
  incidentId: string;
  /** The person who opened the incident, or null for one opened by an alert. */
  userId: string | null;
};

/**
 * Project opt-in (off by default, it spends AI credits): when an incident opens, SEV1-2 get a full
 * investigation and SEV3-4 a quick triage. Goes through the same billing, daily-token and
 * configuration gates as starting either by hand. `handled` is true once a run was started.
 */
export async function maybeAutoInvestigateOnOpen(input: AutoInvestigateInput): Promise<{ handled: boolean; reason?: string }> {
  try {
    if (!isSreEnabled()) return { handled: false, reason: "sre_disabled" };
    const policy = await getNotificationPolicy(input.projectId);
    if (!policy.autoInvestigateOnOpen) return { handled: false, reason: "disabled" };

    const [incident] = await db
      .select({ severity: sreIncidents.severity, status: sreIncidents.status })
      .from(sreIncidents)
      .where(
        and(
          eq(sreIncidents.id, input.incidentId),
          eq(sreIncidents.organizationId, input.organizationId),
          eq(sreIncidents.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!incident || incident.status === "resolved") return { handled: false, reason: "not_open" };

    try {
      validateAIConfiguration();
    } catch {
      return { handled: false, reason: "ai_not_configured" };
    }

    if (incident.severity === "sev3" || incident.severity === "sev4") {
      const triage = await runSreIncidentTriage(input);
      return { handled: triage.success, reason: triage.success ? undefined : "triage_refused" };
    }

    if (await sreDailyTokenLimitResponse(input.organizationId)) return { handled: false, reason: "daily_limit" };
    try {
      await assertCanStartSreInvestigation(input.organizationId);
    } catch {
      return { handled: false, reason: "billing" };
    }
    const started = await startSreIncidentInvestigation({ ...input, enableLiveConnectors: false });
    if (!started.success) return { handled: false, reason: "not_started" };
    // Settles in the background, like the investigate API; billing is taken only on completion.
    void completeSreIncidentInvestigation(started.investigationRunId, started.incident, {
      ...input,
      enableLiveConnectors: false,
    }).catch((error) => logger.error({ error, incidentId: input.incidentId }, "Automatic investigation failed after it started"));
    return { handled: true };
  } catch (error) {
    logger.error({ error, incidentId: input.incidentId }, "Automatic investigation could not start");
    return { handled: false, reason: "error" };
  }
}
