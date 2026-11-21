import { TRIAL_RETENTION } from "@/lib/execution/trial-limits";

/**
 * Raw retention for an organization with no plan (an active or ended trial, or never subscribed): the shortest raw
 * window, which is the trial's.
 */
export const SHORTEST_RAW_RETENTION_DAYS = TRIAL_RETENTION.dataRetentionDays;

/** How long raw monitor results are kept, or why the organization is left alone. */
export type RawRetentionDecision = { days: number; onPlan: boolean } | { skip: string };

const valid = (days: number, onPlan: boolean): RawRetentionDecision =>
  Number.isInteger(days) && days >= 1 ? { days, onPlan } : { skip: `retention ${days} is not a positive number of days` };

/**
 * The one raw-retention rule, shared by the cleanup sweep and the UI.
 * - Self-hosted: the `unlimited` plan row, or the shortest window when it is missing.
 * - A plan uses its `plan_limits` row; a plan without a row is skipped (never guess the most destructive window).
 * - An `active` or `past_due` subscription with no plan yet is skipped: a webhook is still setting it.
 * - Anything else (trial, ended trial, canceled, never subscribed) gets the shortest raw window.
 * - A window below one day is skipped: it would delete everything.
 */
export function resolveRawRetention(
  input:
    | { selfHosted: true; unlimitedDays: number | undefined }
    | { selfHosted: false; subscriptionPlan: string | null; subscriptionStatus: string | null; planDays: number | undefined },
): RawRetentionDecision {
  if (input.selfHosted) return valid(input.unlimitedDays ?? SHORTEST_RAW_RETENTION_DAYS, false);
  if (input.subscriptionPlan) {
    return input.planDays === undefined
      ? { skip: `no plan_limits row for plan ${input.subscriptionPlan}` }
      : valid(input.planDays, true);
  }
  if (input.subscriptionStatus === "active" || input.subscriptionStatus === "past_due") {
    return { skip: `subscription ${input.subscriptionStatus} but no plan yet` };
  }
  return valid(SHORTEST_RAW_RETENTION_DAYS, false);
}
