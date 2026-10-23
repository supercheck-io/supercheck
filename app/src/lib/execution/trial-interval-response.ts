import { NextResponse } from "next/server";
import { trialCheckIntervalViolation } from "./trial-limits";

/** The 400 every monitor write route answers when a trial org asks for a faster check than it may have. */
export async function trialIntervalErrorResponse(
  organizationId: string | null | undefined,
  frequencyMinutes: unknown,
): Promise<NextResponse | null> {
  const violation = await trialCheckIntervalViolation(organizationId, frequencyMinutes);
  if (!violation) return null;
  return NextResponse.json(
    {
      error: "Check interval too short for a trial",
      details: `During the trial, monitors run at most every ${violation.minimumMinutes} minutes. Subscribe for 1-minute checks.`,
    },
    { status: 400 },
  );
}
