// Comparison pages under /compare. All figures come from pricing-data.ts, which
// carries the as-of date and source link for each vendor; do not add claims here.
import { COMPETITORS } from "./pricing-data";

export interface Comparison {
  slug: string;
  vendorKey: "checkly" | "datadog" | "betterstack";
  vendorName: string;
}

export const comparisons: Comparison[] = [
  { slug: "checkly", vendorKey: "checkly", vendorName: "Checkly" },
  { slug: "datadog-synthetics", vendorKey: "datadog", vendorName: "Datadog Synthetics" },
  { slug: "better-stack", vendorKey: "betterstack", vendorName: "Better Stack" },
];

export const getComparison = (slug: string) => comparisons.find((comparison) => comparison.slug === slug);

export const getCompetitor = (vendorKey: Comparison["vendorKey"]) => COMPETITORS.find((c) => c.id === vendorKey);
