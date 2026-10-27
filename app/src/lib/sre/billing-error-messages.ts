export type SreBillingErrorCode =
  | "spending_limit"
  | "subscription_required"
  | "organization_not_found"
  | "trial_limit"
  | "polar_customer_missing"
  | "polar_customer_invalid";

// Fixed client-facing text per code. Billing errors can carry dynamic detail
// that must stay in server logs.
const MESSAGES: Record<SreBillingErrorCode, string> = {
  spending_limit: "Your organization has reached its usage limit. Raise the limit or try again later.",
  subscription_required: "An active subscription is required to use AI SRE.",
  organization_not_found: "Organization not found.",
  polar_customer_missing: "An active subscription is required to use AI SRE.",
  polar_customer_invalid: "Billing could not be verified for this organization. Contact support.",
  trial_limit: "Your trial allowance for AI SRE is used. Subscribe to continue.",
};

export function sreBillingErrorMessage(code: string): string {
  return MESSAGES[code as SreBillingErrorCode] ?? "AI SRE is unavailable for this organization.";
}
