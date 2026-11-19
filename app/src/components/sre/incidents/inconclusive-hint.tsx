import Link from "next/link";

import type { SreIncidentDetail } from "@/actions/sre-incidents";
import { Button } from "@/components/ui/button";

type Fix = { label: string; href: string } | null;

/**
 * Why the last run could not conclude, from what the run already stored, and the one fix most likely to help.
 * Null when the run concluded, is still running, or nothing stored explains the gap.
 */
export function inconclusiveReason(
  detail: Pick<SreIncidentDetail, "incident" | "latestInvestigation" | "capabilities" | "evidence" | "permissions">,
  serviceMappingHref: string,
): { missing: string; fix: Fix } | null {
  const run = detail.latestInvestigation;
  if (!run || run.status === "running" || (run.status === "completed" && run.structured?.outcome !== "inconclusive")) return null;
  const canUpdate = detail.permissions.canUpdate;
  if (!detail.incident.primaryServiceId) {
    return {
      missing: "No service is linked, so no connector could be searched.",
      fix: canUpdate ? { label: "Link a service", href: serviceMappingHref } : null,
    };
  }
  if (!detail.capabilities.hasValidConnector) {
    return {
      missing: "No connector is working, so only Supercheck's own checks were read.",
      fix: canUpdate ? { label: "Add a connector", href: "/org-admin?tab=integrations" } : null,
    };
  }
  const failed = run.steps.filter((step) => step.status === "error").length;
  if (failed > 0) {
    return {
      missing: `${failed} of ${run.steps.length} source ${run.steps.length === 1 ? "search" : "searches"} failed, so those sources were not checked.`,
      fix: canUpdate ? { label: "Check connectors", href: "/org-admin?tab=integrations" } : null,
    };
  }
  if (detail.evidence.length === 0) {
    return { missing: "No evidence was found for this incident's service.", fix: null };
  }
  return null;
}

export function InconclusiveHint({ reason }: { reason: NonNullable<ReturnType<typeof inconclusiveReason>> }) {
  return (
    <div data-testid="inconclusive-hint" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border px-3 py-2">
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-medium">Missing evidence: </span>
        <span className="text-muted-foreground">{reason.missing}</span>
      </p>
      {reason.fix && (
        <Button asChild size="sm" variant="outline">
          <Link href={reason.fix.href}>{reason.fix.label}</Link>
        </Button>
      )}
    </div>
  );
}
