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
  TestEmail,
  UsageNotificationEmail,
} from "@/emails";

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
    text: await render(component, { plainText: true }),
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
    text: await render(component, { plainText: true }),
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
    text: await render(component, { plainText: true }),
  };
}

/**
 * Status Page Verification Email
 */
export async function renderStatusPageVerificationEmail(params: {
  verificationUrl: string;
  statusPageName: string;
}): Promise<RenderedEmail> {
  const component = StatusPageVerificationEmail(params);

  return {
    subject: `Verify your subscription to ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, { plainText: true }),
  };
}

/**
 * Status Page Welcome Email
 */
export async function renderStatusPageWelcomeEmail(params: {
  statusPageName: string;
  statusPageUrl: string;
  unsubscribeUrl: string;
}): Promise<RenderedEmail> {
  const component = StatusPageWelcomeEmail(params);

  return {
    subject: `You're now subscribed to ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, { plainText: true }),
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
  unsubscribeUrl: string;
}): Promise<RenderedEmail> {
  const component = IncidentNotificationEmail(params);

  return {
    subject: `[${params.incidentStatus.toUpperCase()}] ${params.incidentName} - ${params.statusPageName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, { plainText: true }),
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
  type: "failure" | "success" | "warning";
  color: string;
}): Promise<RenderedEmail> {
  const component = MonitorAlertEmail(params);

  return {
    subject: params.title,
    html: await render(component, { pretty: false }),
    text: await render(component, { plainText: true }),
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
    text: await render(component, { plainText: true }),
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
  resourceType: "playwright" | "k6" | "combined" | "spending";
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
    usage_50_percent: `[50% Usage] ${params.organizationName} - Supercheck`,
    usage_80_percent: `[80% Warning] ${params.organizationName} - Supercheck`,
    usage_90_percent: `[90% Critical] ${params.organizationName} - Supercheck`,
    usage_100_percent: `[Limit Reached] ${params.organizationName} - Supercheck`,
    spending_limit_warning: `[Spending Warning] ${params.organizationName} - Supercheck`,
    spending_limit_reached: `[Spending Limit] ${params.organizationName} - Supercheck`,
  };

  return {
    subject:
      subjectMap[params.notificationType] ||
      `Usage Alert - ${params.organizationName}`,
    html: await render(component, { pretty: false }),
    text: await render(component, { plainText: true }),
  };
}
