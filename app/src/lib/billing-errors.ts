export const BILLING_BLOCKED_CODE = "BILLING_BLOCKED";

export const DEFAULT_BILLING_BLOCKED_MESSAGE =
  "Your organization has reached its spending limit. Increase the monthly spending limit or disable hard stop before rerunning.";

export function isBillingBlockedStatus(status: string | null | undefined): boolean {
  return typeof status === "string" && status.toLowerCase() === "blocked";
}

export function isBillingBlockedError(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (value.includes(BILLING_BLOCKED_CODE) ||
      value.toLowerCase().includes("spending limit"))
  );
}

export function formatBillingBlockedMessage(value?: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return DEFAULT_BILLING_BLOCKED_MESSAGE;
  }

  return value.replace(/^BILLING_BLOCKED:\s*/, "").trim();
}

export function buildBillingBlockedResponse(reason?: string | null) {
  return {
    error: reason || DEFAULT_BILLING_BLOCKED_MESSAGE,
    code: BILLING_BLOCKED_CODE,
    blocked: true,
  };
}
