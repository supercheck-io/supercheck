/**
 * Centralized Email Templates
 *
 * All email templates are defined here using react-email components.
 * This provides a single source of truth for all email communications
 * across the application and worker services.
 */

export { BaseLayout } from "./base-layout";
export { PasswordResetEmail } from "./password-reset";
export { OrganizationInvitationEmail } from "./organization-invitation";
export { StatusPageVerificationEmail } from "./status-page-verification";
export { StatusPageWelcomeEmail } from "./status-page-welcome";
export { IncidentNotificationEmail } from "./incident-notification";
export { MonitorAlertEmail } from "./monitor-alert";
export { TestEmail } from "./test-email";
export { UsageNotificationEmail } from "./usage-notification";
