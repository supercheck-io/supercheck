/**
 * Microsoft Teams Webhook URL Validation Constants
 *
 * These domains are the officially supported Microsoft Teams webhook endpoints.
 * This constant is shared between the app (test route) and worker (notification service)
 * to ensure consistent validation.
 *
 * Supported formats per Microsoft documentation:
 * - Power Automate: *.powerplatform.com
 * - Azure Logic Apps: *.logic.azure.com
 * - Legacy Connectors: *.webhook.office.com
 *
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook
 */
export const TEAMS_ALLOWED_DOMAINS = [
  '.powerplatform.com',
  '.logic.azure.com',
  '.webhook.office.com',
] as const;

/**
 * Type for Teams allowed domains
 */
export type TeamsAllowedDomain = (typeof TEAMS_ALLOWED_DOMAINS)[number];

/**
 * Validates if a hostname belongs to an allowed Microsoft Teams webhook domain.
 *
 * @param hostname - The hostname to validate (should be lowercase)
 * @returns true if the hostname ends with one of the allowed domains
 */
export function isValidTeamsWebhookDomain(hostname: string): boolean {
  const lowercaseHostname = hostname.toLowerCase();
  return TEAMS_ALLOWED_DOMAINS.some((domain) =>
    lowercaseHostname.endsWith(domain)
  );
}

/**
 * Returns a user-friendly error message for invalid Teams webhook domains.
 */
export function getTeamsWebhookDomainError(): string {
  return (
    'URL must be a valid Microsoft Teams webhook URL. ' +
    'Supported domains: *.powerplatform.com, *.logic.azure.com, *.webhook.office.com'
  );
}
