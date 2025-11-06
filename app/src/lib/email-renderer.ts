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
  OrganizationInvitationEmail,
  StatusPageVerificationEmail,
  StatusPageWelcomeEmail,
  IncidentNotificationEmail,
  MonitorAlertEmail,
  TestEmail,
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
