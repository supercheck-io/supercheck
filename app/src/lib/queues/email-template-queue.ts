import { Queue } from "bullmq";
import { getQueues, EMAIL_TEMPLATE_QUEUE } from "../queue";

/**
 * @deprecated The worker now renders alert emails locally (worker/src/emails).
 * shortcut: kept for rolling deploys from workers <= current release; delete next release
 */
/**
 * Email Template Rendering Queue
 *
 * This queue handles rendering of email templates using react-email.
 * The worker requests template rendering, and the app processor responds
 * with rendered HTML and plain text versions.
 *
 * Queue Flow:
 * 1. Worker adds job to queue with template type and data
 * 2. App processor picks up job and renders template
 * 3. Job returns rendered email (HTML + text + subject)
 * 4. Worker receives result and sends email
 *
 * NOTE: This module now uses the centralized queue from queue.ts to ensure
 * the queue appears in the Bull Dashboard and shares the same Redis connection.
 */

export const EMAIL_TEMPLATE_QUEUE_NAME = EMAIL_TEMPLATE_QUEUE;

export interface EmailTemplateJob {
  template: EmailTemplateType;
  data: EmailTemplateData;
}

export type EmailTemplateType =
  | "monitor-alert"
  | "job-failure"
  | "job-success"
  | "job-timeout"
  | "status-page-verification"
  | "status-page-welcome"
  | "incident-notification"
  | "password-reset"
  | "organization-invitation"
  | "test-email";

export interface EmailTemplateData {
  // Monitor Alert
  title?: string;
  message?: string;
  fields?: Array<{ title: string; value: string }>;
  footer?: string;
  type?: "failure" | "success" | "warning";
  color?: string;

  // Job Alerts
  jobName?: string;
  jobStatus?: string;
  duration?: number;
  errorMessage?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  runId?: string;
  dashboardUrl?: string;

  // Status Page
  statusPageName?: string;
  statusPageUrl?: string;
  verificationUrl?: string;
  unsubscribeUrl?: string;
  incidentName?: string;
  incidentStatus?: string;
  incidentImpact?: string;
  incidentDescription?: string;
  affectedComponents?: string[];
  updateTimestamp?: string;
  language?: string;

  // Authentication
  resetUrl?: string;
  userEmail?: string;

  // Organization
  inviteUrl?: string;
  organizationName?: string;
  role?: string;
  projectInfo?: string;

  // Test Email
  testMessage?: string;

  // Generic fields for extensibility
  [key: string]: unknown;
}

export interface RenderedEmailResult {
  subject: string;
  html: string;
  text: string;
}

/**
 * Get the email template queue instance from the centralized queue system
 */
export async function getEmailTemplateQueue(): Promise<
  Queue<EmailTemplateJob, RenderedEmailResult>
> {
  const { emailTemplateQueue } = await getQueues();
  return emailTemplateQueue as Queue<EmailTemplateJob, RenderedEmailResult>;
}
