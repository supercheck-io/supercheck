"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PauseCircle } from "lucide-react";

type UsageResponse = { spending?: { isAtLimit?: boolean; hardStopEnabled?: boolean; limitEnabled?: boolean } };

async function fetchSpending(): Promise<UsageResponse | null> {
  const response = await fetch("/api/billing/usage");
  return response.ok ? response.json() : null;
}

/** Tells org admins which work is paused while the hard-stop overage cap is reached. */
export function SpendingCapBanner({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ["billing-usage", "spending-cap-banner"],
    queryFn: fetchSpending,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const spending = data?.spending;
  if (!enabled || !spending?.limitEnabled || !spending.hardStopEnabled || !spending.isAtLimit) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <span className="flex items-center gap-2">
        <PauseCircle className="h-4 w-4" aria-hidden="true" />
        Spending cap reached. Browser checks, test and job runs, k6 load tests and full AI SRE
        investigations are paused. HTTP, website, ping and port monitors keep running.
      </span>
      <Link href="/org-admin?tab=subscription" className="font-medium underline underline-offset-4">
        Raise the cap
      </Link>
    </div>
  );
}
