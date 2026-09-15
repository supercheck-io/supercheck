import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { isSreAutomaticTriageEnabled } from "@/sre/lib/feature-gates";
import { runSreIncidentTriage, type RunSreIncidentTriageResult } from "@/sre/lib/triage-runner";

export type AutomaticSreTriageInput = {
  userId: string;
  organizationId: string;
  project: {
    id: string;
    userRole: string;
  };
  incidentId: string;
  existingIncident: boolean;
  alertStatus: "firing" | "resolved";
};

export type AutomaticSreTriageResult =
  | { attempted: false; reason: "disabled" | "existing_incident" | "resolved_alert" | "insufficient_permissions" }
  | ({ attempted: true } & RunSreIncidentTriageResult);

export async function maybeRunAutomaticSreTriage(input: AutomaticSreTriageInput): Promise<AutomaticSreTriageResult> {
  if (!isSreAutomaticTriageEnabled()) {
    return { attempted: false, reason: "disabled" };
  }

  if (input.existingIncident) {
    return { attempted: false, reason: "existing_incident" };
  }

  if (input.alertStatus !== "firing") {
    return { attempted: false, reason: "resolved_alert" };
  }

  const permissionContext = {
    userId: input.userId,
    organizationId: input.organizationId,
    project: input.project,
  };
  const canInvestigateIncident = checkPermissionWithContext("sre_incident", "investigate", permissionContext);
  const canRunInvestigation = checkPermissionWithContext("sre_investigation", "investigate", permissionContext);

  if (!canInvestigateIncident || !canRunInvestigation) {
    return { attempted: false, reason: "insufficient_permissions" };
  }

  try {
    const result = await runSreIncidentTriage({
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.project.id,
      incidentId: input.incidentId,
    });

    return { attempted: true, ...result };
  } catch {
    return { attempted: true, success: false, status: 502, error: "SRE triage failed" };
  }
}
