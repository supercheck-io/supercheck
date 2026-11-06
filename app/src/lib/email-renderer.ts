/**
 * Email Template Renderer Service
 *
 * This service provides a unified interface for rendering email templates
 * using react-email. It can be used directly in the app (server-side) or
 * via the API endpoint for external services like the worker.
 */

import { render } from "@react-email/render";
import {
  PasswordResetEmail,
  EmailVerificationEmail,
  OrganizationInvitationEmail,
  StatusPageVerificationEmail,
  StatusPageWelcomeEmail,
  IncidentNotificationEmail,
  MonitorAlertEmail,
  alertEmailSubject,
  IncidentUpdateEmail,
  incidentUpdateHeadline,
  type IncidentUpdateEmailProps,
  TestEmail,
  UsageNotificationEmail,
  TrialNotificationEmail,
  trialNotificationSubject,
  PLAIN_TEXT_RENDER_OPTIONS,
  type TrialNotificationKind,
} from "@/emails";
import {
  getTranslations,
  getLocaleForLanguage,
  translateIncidentStatus,
} from "@/lib/status-page-translations";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Password Reset Email
 */
export async function renderPasswordResetEmail(params: {
  resetUrl: string;
  userEmail: string;
}): Promise<RenderedEmail> {
  const component = PasswordResetEmail(params);

  return {
    subject: "Reset your Supercheck password",
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Email Verification Email
 */
export async function renderEmailVerificationEmail(params: {
  verificationUrl: string;
  userEmail: string;
  userName?: string;
}): Promise<RenderedEmail> {
  const component = EmailVerificationEmail(params);

  return {
    subject: "Verify your email address - Supercheck",
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Organization Invitation Email
 */
export async function renderOrganizationInvitationEmail(params: {
  inviteUrl: string;
  organizationName: string;
  role: string;
  projectInfo?: string;
}): Promise<RenderedEmail> {
  const component = OrganizationInvitationEmail(params);

  return {
    subject: `You're invited to join ${params.organizationName} on Supercheck`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Status Page Verification Email
 */
export async function renderStatusPageVerificationEmail(params: {
  verificationUrl: string;
  statusPageName: string;
  language?: string;
}): Promise<RenderedEmail> {
  const component = StatusPageVerificationEmail(params);
  const t = getTranslations(params.language ?? "en");

  return {
    subject: `${t.emailSubjectVerify} ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Status Page Welcome Email
 */
export async function renderStatusPageWelcomeEmail(params: {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
  language?: string;
}): Promise<RenderedEmail> {
  const component = StatusPageWelcomeEmail(params);
  const t = getTranslations(params.language ?? "en");

  return {
    subject: `${t.emailSubjectWelcome} ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Incident Notification Email
 */
export async function renderIncidentNotificationEmail(params: {
  statusPageName: string;
  statusPageUrl: string;
  incidentName: string;
  incidentStatus: string;
  incidentImpact: string;
  incidentDescription: string;
  affectedComponents: string[];
  updateTimestamp: string;
  unsubscribeUrl?: string;
  supportUrl?: string | null;
  language?: string;
}): Promise<RenderedEmail> {
  const component = IncidentNotificationEmail(params);
  const language = params.language ?? "en";
  const t = getTranslations(language);
  const locale = getLocaleForLanguage(language);
  const translatedStatus = translateIncidentStatus(params.incidentStatus, t);

  return {
    subject: `[${translatedStatus.toLocaleUpperCase(locale)}] ${params.incidentName} - ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Monitor Alert Email
 */
export async function renderMonitorAlertEmail(params: {
  title: string;
  message: string;
  fields: Array<{ title: string; value: string }>;
  footer: string;
  type: "failure" | "success" | "recovery" | "warning" | "info";
  color?: string;
  incidentsUrl?: string;
}): Promise<RenderedEmail> {
  const component = MonitorAlertEmail(params);

  return {
    subject: alertEmailSubject(params.title),
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Test Email
 */
export async function renderTestEmail(params?: {
  testMessage?: string;
}): Promise<RenderedEmail> {
  const component = TestEmail(params || {});

  return {
    subject: "Test Email from Supercheck",
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Usage Notification Email
 */
export async function renderUsageNotificationEmail(params: {
  organizationName: string;
  notificationType:
    | "usage_50_percent"
    | "usage_80_percent"
    | "usage_90_percent"
    | "usage_100_percent"
    | "spending_limit_warning"
    | "spending_limit_reached";
  resourceType: "playwright" | "k6" | "ai" | "sre" | "combined" | "spending";
  usageAmount: number;
  usageLimit: number;
  usagePercentage: number;
  currentSpendingDollars?: number;
  spendingLimitDollars?: number;
  billingPageUrl: string;
  periodEndDate: string;
}): Promise<RenderedEmail> {
  const component = UsageNotificationEmail(params);

  const subjectMap: Record<string, string> = {
    usage_50_percent: `[Supercheck] 50% usage: ${params.organizationName}`,
    usage_80_percent: `[Supercheck] 80% usage warning: ${params.organizationName}`,
    usage_90_percent: `[Supercheck] 90% usage critical: ${params.organizationName}`,
    usage_100_percent: `[Supercheck] Usage limit reached: ${params.organizationName}`,
    spending_limit_warning: `[Supercheck] Spending warning: ${params.organizationName}`,
    spending_limit_reached: `[Supercheck] Spending limit reached: ${params.organizationName}`,
  };

  return {
    subject:
      subjectMap[params.notificationType] ||
      `[Supercheck] Usage alert: ${params.organizationName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Free trial reminder (midway, ending, ended)
 */
export async function renderTrialNotificationEmail(params: {
  organizationName: string;
  kind: TrialNotificationKind;
  daysRemaining: number;
  subscribeUrl: string;
  manageBillingUrl?: string;
}): Promise<RenderedEmail> {
  const component = TrialNotificationEmail(params);

  return {
    subject: trialNotificationSubject(params.kind, params.organizationName, params.daysRemaining),
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}

/**
 * Team-facing incident update email (created, assigned, resolved, ...).
 * Not the public status-page subscriber email (see renderIncidentNotificationEmail).
 */
export async function renderIncidentUpdateEmail(
  params: IncidentUpdateEmailProps,
): Promise<RenderedEmail> {
  const component = IncidentUpdateEmail(params);

  return {
    subject: `[Supercheck] ${incidentUpdateHeadline(params.event, params.actorName, params.assigneeName)}: #${params.incidentNumber} ${params.title} (${params.severity.toUpperCase()})`,
    html: await render(component, { pretty: false }),
    text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
  };
}
