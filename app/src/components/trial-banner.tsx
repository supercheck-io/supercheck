"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import {
  SUBSCRIPTION_STATUS_QUERY_KEY,
  fetchSubscriptionStatus,
  type TrialStatus,
} from "@/components/subscription-guard";

/** Days at or below which the banner turns into a call to subscribe. */
export const TRIAL_ENDING_SOON_DAYS = 3;

export function trialBannerMessage(trial: TrialStatus): string {
  if (trial.daysRemaining <= 1) return "Your free trial ends today.";
  return `Your free trial has ${trial.daysRemaining} days left.`;
}

/**
 * Shows how long the free trial lasts, with a way to subscribe. Rendered only
 * while a trial is active; paying organizations and ended trials show nothing
 * here (an ended trial is explained on the subscribe page).
 */
export function TrialBanner({
  initialTrial,
}: {
  initialTrial: TrialStatus | null;
}) {
  const { data } = useQuery({
    queryKey: SUBSCRIPTION_STATUS_QUERY_KEY,
    queryFn: fetchSubscriptionStatus,
    initialData: initialTrial
      ? { isActive: false, plan: null, trial: initialTrial }
      : undefined,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    enabled: !!initialTrial,
  });

  const trial = data?.trial;
  if (!trial?.active || data?.isActive) return null;
  const endingSoon = trial.daysRemaining <= TRIAL_ENDING_SOON_DAYS;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm ${
        endingSoon
          ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
          : "bg-muted/50 text-muted-foreground"
      }`}
    >
      <span className="flex items-center gap-2">
        <Clock className="h-4 w-4" aria-hidden="true" />
        {trialBannerMessage(trial)} Subscribe to keep your monitors and status
        pages running after it ends.
      </span>
      <Link
        href="/subscribe"
        className="font-medium underline underline-offset-4"
      >
        Choose a plan
      </Link>
    </div>
  );
}
