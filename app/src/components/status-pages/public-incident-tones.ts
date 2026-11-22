// Colours for incident badges on the public status pages, shared by the incident list and
// the incident detail page so both read the same. Public pages are exempt from the token rule.

export type PublicIncidentStatus = "investigating" | "identified" | "monitoring" | "resolved" | "scheduled";
export type PublicIncidentImpact = "none" | "minor" | "major" | "critical";

export const INCIDENT_PILL =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

const GRAY = "border-gray-200 bg-gray-100 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300";

export const INCIDENT_STATUS_TONE: Record<PublicIncidentStatus, string> = {
  investigating: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  identified: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
  monitoring: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  resolved: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/50 dark:text-green-300",
  scheduled: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300",
};

export const INCIDENT_STATUS_DOT: Record<PublicIncidentStatus, string> = {
  investigating: "bg-amber-500",
  identified: "bg-orange-500",
  monitoring: "bg-blue-500",
  resolved: "bg-green-500",
  scheduled: "bg-purple-500",
};

export const INCIDENT_IMPACT_TONE: Record<PublicIncidentImpact, string> = {
  critical: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300",
  major: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
  minor: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  none: GRAY,
};

export const incidentStatusTone = (status: string) =>
  INCIDENT_STATUS_TONE[status as PublicIncidentStatus] ?? GRAY;
export const incidentStatusDot = (status: string) =>
  INCIDENT_STATUS_DOT[status as PublicIncidentStatus] ?? "bg-gray-400";
export const incidentImpactTone = (impact: string) =>
  INCIDENT_IMPACT_TONE[impact as PublicIncidentImpact] ?? GRAY;
