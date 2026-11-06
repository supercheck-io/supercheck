import type { SreServiceListItem } from "@/actions/sre-services";
import type { TableBadgeTone } from "@/components/ui/table-badge";

// Tier 1 is the most critical; colour fades with criticality.
export const TIER_TONES: Record<SreServiceListItem["tier"], TableBadgeTone> = {
  "1": "purple",
  "2": "indigo",
  "3": "info",
  "4": "slate",
};

export const TIER_HINT: Record<SreServiceListItem["tier"], string> = {
  "1": "Tier 1: customer critical.",
  "2": "Tier 2: business critical.",
  "3": "Tier 3: standard.",
  "4": "Tier 4: internal.",
};

/** Production stands out in amber; other environments get calmer tones. Environment is free text. */
export function environmentTone(environment: string): TableBadgeTone {
  const value = environment.trim().toLowerCase();
  if (value === "production" || value === "prod") return "warning";
  if (value === "staging" || value === "stage" || value === "preprod") return "indigo";
  if (value === "development" || value === "dev" || value === "test" || value === "local") return "slate";
  return "info";
}
