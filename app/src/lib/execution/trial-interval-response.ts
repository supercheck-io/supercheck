import { NextResponse } from "next/server";
import {
  SubscriptionAccessDeniedError,
  subscriptionService,
} from "@/lib/services/subscription-service";
import { trialCheckIntervalViolation } from "./trial-limits";
import { checkResumeWithinPlan } from "@/lib/middleware/plan-enforcement";

/** The 400 every monitor write route answers when a trial org asks for a faster check than it may have. */
export async function trialIntervalErrorResponse(
  organizationId: string | null | undefined,
  frequencyMinutes: unknown,
): Promise<NextResponse | null> {
  const violation = await trialCheckIntervalViolation(
    organizationId,
    frequencyMinutes,
  );
  if (!violation) return null;
  return NextResponse.json(
    {
      error: "Check interval too short for a trial",
      details: `During the trial, monitors run at most every ${violation.minimumMinutes} minutes. Subscribe for 1-minute checks.`,
    },
    { status: 400 },
  );
}

/**
 * The 402 for turning a paused monitor back on without a plan. A trial that has ended pauses the
 * organization's monitors, and only subscribing brings them back, so the write routes must not undo it.
 */
export async function monitorResumeBlockedResponse(
  organizationId: string | null | undefined,
  currentStatus: string,
  change: { enabled?: unknown; status?: unknown },
): Promise<NextResponse | null> {
  const resuming =
    change.enabled === true ||
    (typeof change.status === "string" && change.status !== "paused");
  if (!organizationId || currentStatus !== "paused" || !resuming) return null;
  try {
    await subscriptionService.blockUntilSubscribed(organizationId);
  } catch (error) {
    if (!(error instanceof SubscriptionAccessDeniedError)) throw error;
    return NextResponse.json(
      { error: error.message, code: error.reason },
      { status: 402 },
    );
  }
  const cap = await checkResumeWithinPlan(organizationId, "monitor");
  if (cap.allowed) return null;
  return NextResponse.json(
    { error: cap.error, code: "plan_limit", limit: cap.limit, upgrade: cap.upgrade },
    { status: 403 },
  );
}
