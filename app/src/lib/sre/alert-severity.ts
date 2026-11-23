import type { AlertType } from "@/db/schema/types";

export type SreSeverity = "sev1" | "sev2" | "sev3" | "sev4";

// By alert type only: message text is free-form ("non-critical" must not page as SEV1).
const SEVERITY_BY_TYPE: Partial<Record<AlertType, SreSeverity>> = {
  job_timeout: "sev1",
  monitor_failure: "sev2",
  job_failed: "sev2",
  ssl_expiring: "sev3",
};

/** Default incident severity for an alert type; the source's configured incident severity overrides it. */
export function alertSeverity(type: string): SreSeverity {
  return SEVERITY_BY_TYPE[type as AlertType] ?? "sev4";
}

/** True when `candidate` is more severe than `current` (sev1 is the most severe). */
export function isMoreSevere(candidate: string, current: string) {
  return candidate < current;
}
