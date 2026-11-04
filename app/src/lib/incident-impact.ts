import type { ComponentStatus, IncidentImpact } from "@/db/schema/types";

// Banner severity of an open incident, so an incident with no visible components still shows.
// Impact "none" is informational and does not change the banner. Shared by the public page and the badge.
export const IMPACT_BANNER_STATUS: Partial<Record<IncidentImpact, ComponentStatus>> = {
  critical: "major_outage",
  major: "partial_outage",
  minor: "degraded_performance",
};
