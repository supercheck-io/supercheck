import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../queue";
import {
  EMAIL_TEMPLATE_QUEUE_NAME,
  EmailTemplateJob,
  RenderedEmailResult,
} from "../queues/email-template-queue";
import {
  renderMonitorAlertEmail,
  renderPasswordResetEmail,
  renderOrganizationInvitationEmail,
  renderStatusPageVerificationEmail,
  renderStatusPageWelcomeEmail,
  renderIncidentNotificationEmail,
  renderTestEmail,
} from "../email-renderer";

/**
 * Email Template Processor
 *
 * This worker processes email template rendering jobs from the queue.
 * It renders templates using react-email and returns the HTML/text versions.
 *
 * The processor runs in the Next.js app and is initialized when the app starts.
 */

let emailTemplateWorker: Worker<EmailTemplateJob, RenderedEmailResult> | null =
  null;

/**
 * Process an email template rendering job
 */
async function processEmailTemplateJob(
  job: Job<EmailTemplateJob, RenderedEmailResult>
): Promise<RenderedEmailResult> {
  const { template, data } = job.data;

  console.log(
    `[Email Template Processor] Processing job ${job.id} for template: ${template}`
  );

  try {
    let result: RenderedEmailResult;

    switch (template) {
      case "monitor-alert":
        result = await renderMonitorAlertEmail({
          title: data.title || "Monitor Alert",
          message: data.message || "",
          fields: data.fields || [],
          footer: data.footer || "Supercheck Monitoring System",
          type: (data.type as "failure" | "success" | "warning") || "failure",
          color: data.color || "#dc2626",
        });
        break;

      case "job-failure":
        result = await renderJobFailureEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          errorMessage: data.errorMessage,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        });
        break;

      case "job-success":
        result = await renderJobSuccessEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        });
        break;

      case "job-timeout":
        result = await renderJobTimeoutEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        });
        break;

      case "status-page-verification":
        result = await renderStatusPageVerificationEmail({
          verificationUrl: data.verificationUrl || "",
          statusPageName: data.statusPageName || "",
        });
        break;

      case "status-page-welcome":
        result = await renderStatusPageWelcomeEmail({
          statusPageName: data.statusPageName || "",
          statusPageUrl: data.statusPageUrl || "",
          unsubscribeUrl: data.unsubscribeUrl || "",
        });
        break;

      case "incident-notification":
        result = await renderIncidentNotificationEmail({
          statusPageName: data.statusPageName || "",
          statusPageUrl: data.statusPageUrl || "",
          incidentName: data.incidentName || "",
          incidentStatus: data.incidentStatus || "",
          incidentImpact: data.incidentImpact || "",
          incidentDescription: data.incidentDescription || "",
          affectedComponents: data.affectedComponents || [],
          updateTimestamp: data.updateTimestamp || new Date().toISOString(),
          unsubscribeUrl: data.unsubscribeUrl || "",
        });
        break;

      case "password-reset":
        result = await renderPasswordResetEmail({
          resetUrl: data.resetUrl || "",
          userEmail: data.userEmail || "",
        });
        break;

      case "organization-invitation":
        result = await renderOrganizationInvitationEmail({
          inviteUrl: data.inviteUrl || "",
          organizationName: data.organizationName || "",
          role: data.role || "",
          projectInfo: data.projectInfo,
        });
        break;

      case "test-email":
        result = await renderTestEmail({
          testMessage: data.testMessage,
        });
        break;

      default:
        throw new Error(`Unknown template type: ${template}`);
    }

    console.log(
      `[Email Template Processor] Successfully rendered template ${template} for job ${job.id}`
    );

    return result;
  } catch (error) {
    console.error(
      `[Email Template Processor] Error rendering template ${template}:`,
      error
    );
    throw error;
  }
}

/**
 * Render job failure email template
 * Generic template without test statistics (users can view full details in dashboard)
 */
async function renderJobFailureEmail(params: {
  jobName: string;
  duration: number;
  errorMessage?: string;
  runId?: string;
  dashboardUrl?: string;
}): Promise<RenderedEmailResult> {
  const fields: Array<{ title: string; value: string }> = [
    { title: "Job Name", value: params.jobName },
    { title: "Status", value: "Failed" },
    { title: "Duration", value: `${params.duration} seconds` },
  ];

  if (params.errorMessage) {
    fields.push({ title: "Error", value: params.errorMessage });
  }

  if (params.runId) {
    fields.push({ title: "Run ID", value: params.runId });
  }

  return renderMonitorAlertEmail({
    title: `Job Failed - ${params.jobName}`,
    message: `Job "${params.jobName}" has failed. Please review the details below.`,
    fields,
    footer: params.dashboardUrl
      ? `View details: ${params.dashboardUrl}`
      : "Supercheck Job Monitoring",
    type: "failure",
    color: "#dc2626",
  });
}

/**
 * Render job success email template
 * Generic template without test statistics (users can view full details in dashboard)
 */
async function renderJobSuccessEmail(params: {
  jobName: string;
  duration: number;
  runId?: string;
  dashboardUrl?: string;
}): Promise<RenderedEmailResult> {
  const fields: Array<{ title: string; value: string }> = [
    { title: "Job Name", value: params.jobName },
    { title: "Status", value: "Success" },
    { title: "Duration", value: `${params.duration} seconds` },
  ];

  if (params.runId) {
    fields.push({ title: "Run ID", value: params.runId });
  }

  return renderMonitorAlertEmail({
    title: `Job Completed - ${params.jobName}`,
    message: `Job "${params.jobName}" has completed successfully.`,
    fields,
    footer: params.dashboardUrl
      ? `View details: ${params.dashboardUrl}`
      : "Supercheck Job Monitoring",
    type: "success",
    color: "#10b981",
  });
}

/**
 * Render job timeout email template
 */
async function renderJobTimeoutEmail(params: {
  jobName: string;
  duration: number;
  runId?: string;
  dashboardUrl?: string;
}): Promise<RenderedEmailResult> {
  const fields: Array<{ title: string; value: string }> = [
    { title: "Job Name", value: params.jobName },
    { title: "Status", value: "Timeout" },
    { title: "Duration", value: `${params.duration} seconds` },
  ];

  if (params.runId) {
    fields.push({ title: "Run ID", value: params.runId });
  }

  return renderMonitorAlertEmail({
    title: `Job Timeout - ${params.jobName}`,
    message: `Job "${params.jobName}" timed out after ${params.duration} seconds. No ping received within expected interval.`,
    fields,
    footer: params.dashboardUrl
      ? `View details: ${params.dashboardUrl}`
      : "Supercheck Job Monitoring",
    type: "warning",
    color: "#f59e0b",
  });
}

/**
 * Initialize the email template processor worker
 */
export async function initializeEmailTemplateProcessor(): Promise<void> {
  if (emailTemplateWorker) {
    console.log("[Email Template Processor] Already initialized");
    return;
  }

  const connection = await getRedisConnection();

  emailTemplateWorker = new Worker<EmailTemplateJob, RenderedEmailResult>(
    EMAIL_TEMPLATE_QUEUE_NAME,
    processEmailTemplateJob,
    {
      connection,
      concurrency: 5, // Process up to 5 templates concurrently
      limiter: {
        max: 10, // Max 10 jobs
        duration: 1000, // Per second
      },
    }
  );

  emailTemplateWorker.on("completed", (job) => {
    console.log(
      `[Email Template Processor] Job ${job.id} completed successfully`
    );
  });

  emailTemplateWorker.on("failed", (job, err) => {
    console.error(
      `[Email Template Processor] Job ${job?.id} failed:`,
      err.message
    );
  });

  emailTemplateWorker.on("error", (err) => {
    console.error("[Email Template Processor] Worker error:", err);
  });

  console.log(
    "[Email Template Processor] Initialized and ready to process jobs"
  );
}

/**
 * Gracefully shutdown the email template processor
 */
export async function shutdownEmailTemplateProcessor(): Promise<void> {
  if (emailTemplateWorker) {
    await emailTemplateWorker.close();
    emailTemplateWorker = null;
    console.log("[Email Template Processor] Shutdown complete");
  }
}
