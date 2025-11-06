import { Queue, QueueEvents } from "bullmq";
import { getRedisConnection } from "../queue";

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
 */

export const EMAIL_TEMPLATE_QUEUE_NAME = "email-template-render";

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

let emailTemplateQueue: Queue<EmailTemplateJob, RenderedEmailResult> | null =
  null;
let emailTemplateQueueEvents: QueueEvents | null = null;

/**
 * Get or create the email template queue instance
 */
export async function getEmailTemplateQueue(): Promise<
  Queue<EmailTemplateJob, RenderedEmailResult>
> {
  if (emailTemplateQueue) {
    return emailTemplateQueue;
  }

  const connection = await getRedisConnection();

  emailTemplateQueue = new Queue<EmailTemplateJob, RenderedEmailResult>(
    EMAIL_TEMPLATE_QUEUE_NAME,
    {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100, // Keep last 100 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
          count: 50, // Keep last 50 failed jobs
        },
      },
    }
  );

  emailTemplateQueue.on("error", (error) => {
    console.error("[Email Template Queue] Error:", error);
  });

  console.log("[Email Template Queue] Initialized");

  return emailTemplateQueue;
}

/**
 * Get queue events for monitoring
 */
export async function getEmailTemplateQueueEvents(): Promise<QueueEvents> {
  if (emailTemplateQueueEvents) {
    return emailTemplateQueueEvents;
  }

  const connection = await getRedisConnection();

  emailTemplateQueueEvents = new QueueEvents(EMAIL_TEMPLATE_QUEUE_NAME, {
    connection,
  });

  emailTemplateQueueEvents.on("completed", ({ jobId }) => {
    console.log(`[Email Template Queue] Job ${jobId} completed`);
  });

  emailTemplateQueueEvents.on("failed", ({ jobId, failedReason }) => {
    console.error(
      `[Email Template Queue] Job ${jobId} failed: ${failedReason}`
    );
  });

  return emailTemplateQueueEvents;
}

/**
 * Add a job to render an email template
 *
 * @param template - The template type to render
 * @param data - The data for the template
 * @returns The job instance
 */
export async function addEmailTemplateRenderJob(
  template: EmailTemplateType,
  data: EmailTemplateData
) {
  const queue = await getEmailTemplateQueue();

  const job = await queue.add(
    "render-template",
    { template, data },
    {
      jobId: `${template}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    }
  );

  console.log(
    `[Email Template Queue] Added job ${job.id} for template: ${template}`
  );

  return job;
}

/**
 * Wait for a job to complete and return the result
 *
 * @param jobId - The job ID to wait for
 * @param timeout - Timeout in milliseconds (default: 10 seconds)
 * @returns The rendered email result
 */
export async function waitForEmailTemplateResult(
  jobId: string,
  timeout: number = 10000
): Promise<RenderedEmailResult> {
  const queue = await getEmailTemplateQueue();
  const job = await queue.getJob(jobId);

  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  // Wait for job to complete with timeout
  const result = await Promise.race([
    job.waitUntilFinished(await getEmailTemplateQueueEvents(), timeout),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Template rendering timeout after ${timeout}ms`)),
        timeout
      )
    ),
  ]);

  return result;
}

/**
 * Gracefully close queue connections
 */
export async function closeEmailTemplateQueue(): Promise<void> {
  if (emailTemplateQueue) {
    await emailTemplateQueue.close();
    emailTemplateQueue = null;
  }

  if (emailTemplateQueueEvents) {
    await emailTemplateQueueEvents.close();
    emailTemplateQueueEvents = null;
  }

  console.log("[Email Template Queue] Closed");
}
