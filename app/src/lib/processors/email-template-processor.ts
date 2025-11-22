import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../queue";
import {
  EMAIL_TEMPLATE_QUEUE_NAME,
  EmailTemplateJob,
  EmailTemplateData,
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

// Standardized colors matching Job templates
const COLOR_SUCCESS = "#10b981"; // Green
const COLOR_FAILURE = "#dc2626"; // Red
const COLOR_WARNING = "#f59e0b"; // Amber
const COLOR_INFO = "#10b981";    // Green (using Success color for Info/Transactional to maintain consistency)

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
    // Use static imports for email renderer
    const emailRenderer = {
      renderMonitorAlertEmail,
      renderPasswordResetEmail,
      renderOrganizationInvitationEmail,
      renderStatusPageVerificationEmail,
      renderStatusPageWelcomeEmail,
      renderIncidentNotificationEmail,
      renderTestEmail,
    };

    let result: RenderedEmailResult;

    switch (template) {
      case "monitor-alert":
        const type = (data.type as "failure" | "success" | "warning") || "failure";
        // Enforce consistent colors based on type, ignoring data.color to ensure uniformity
        const color = type === 'success' ? COLOR_SUCCESS : type === 'warning' ? COLOR_WARNING : COLOR_FAILURE;
        
        result = await emailRenderer.renderMonitorAlertEmail({
          title: data.title || "Monitor Alert",
          message: data.message || "",
          fields: data.fields || [],
          footer: data.footer || "Supercheck Monitoring System",
          type: type,
          color: color,
        });
        break;

      case "job-failure":
        result = await renderJobFailureEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          errorMessage: data.errorMessage,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        }, emailRenderer.renderMonitorAlertEmail);
        break;

      case "job-success":
        result = await renderJobSuccessEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        }, emailRenderer.renderMonitorAlertEmail);
        break;

      case "job-timeout":
        result = await renderJobTimeoutEmail({
          jobName: data.jobName || "Unknown Job",
          duration: data.duration || 0,
          runId: data.runId,
          dashboardUrl: data.dashboardUrl,
        }, emailRenderer.renderMonitorAlertEmail);
        break;

      case "status-page-verification":
        result = await emailRenderer.renderStatusPageVerificationEmail({
          verificationUrl: data.verificationUrl || "",
          statusPageName: data.statusPageName || "",
        });
        break;

      case "status-page-welcome":
        result = await emailRenderer.renderStatusPageWelcomeEmail({
          statusPageName: data.statusPageName || "",
          statusPageUrl: data.statusPageUrl || "",
          unsubscribeUrl: data.unsubscribeUrl || "",
        });
        break;

      case "incident-notification":
        result = await emailRenderer.renderIncidentNotificationEmail({
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
        result = await emailRenderer.renderPasswordResetEmail({
          resetUrl: data.resetUrl || "",
          userEmail: data.userEmail || "",
        });
        break;

      case "organization-invitation":
        result = await emailRenderer.renderOrganizationInvitationEmail({
          inviteUrl: data.inviteUrl || "",
          organizationName: data.organizationName || "",
          role: data.role || "",
          projectInfo: data.projectInfo,
        });
        break;

      case "test-email":
        result = await emailRenderer.renderTestEmail({
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
    
    // Fallback to simple HTML template generation
    console.log(
      `[Email Template Processor] Using fallback template generation for ${template}`
    );
    
    return generateFallbackEmail(template, data);
  }
}

/**
 * Render job failure email template
 * Generic template without test statistics (users can view full details in dashboard)
 */
async function renderJobFailureEmail(
  params: {
    jobName: string;
    duration: number;
    errorMessage?: string;
    runId?: string;
    dashboardUrl?: string;
  },
  renderFn: typeof renderMonitorAlertEmail
): Promise<RenderedEmailResult> {
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

  if (params.dashboardUrl) {
    fields.push({ title: "🔗 Job Details", value: params.dashboardUrl });
  }

  return renderFn({
    title: `Job Failed - ${params.jobName}`,
    message: `Job "${params.jobName}" has failed. Please review the details below.`,
    fields,
    footer: "Supercheck Job Monitoring",
    type: "failure",
    color: COLOR_FAILURE,
  });
}

/**
 * Render job success email template
 * Generic template without test statistics (users can view full details in dashboard)
 */
async function renderJobSuccessEmail(
  params: {
    jobName: string;
    duration: number;
    runId?: string;
    dashboardUrl?: string;
  },
  renderFn: typeof renderMonitorAlertEmail
): Promise<RenderedEmailResult> {
  const fields: Array<{ title: string; value: string }> = [
    { title: "Job Name", value: params.jobName },
    { title: "Status", value: "Success" },
    { title: "Duration", value: `${params.duration} seconds` },
  ];

  if (params.runId) {
    fields.push({ title: "Run ID", value: params.runId });
  }

  if (params.dashboardUrl) {
    fields.push({ title: "🔗 Job Details", value: params.dashboardUrl });
  }

  return renderFn({
    title: `Job Completed - ${params.jobName}`,
    message: `Job "${params.jobName}" has completed successfully.`,
    fields,
    footer: "Supercheck Job Monitoring",
    type: "success",
    color: COLOR_SUCCESS,
  });
}

/**
 * Render job timeout email template
 */
async function renderJobTimeoutEmail(
  params: {
    jobName: string;
    duration: number;
    runId?: string;
    dashboardUrl?: string;
  },
  renderFn: typeof renderMonitorAlertEmail
): Promise<RenderedEmailResult> {
  const fields: Array<{ title: string; value: string }> = [
    { title: "Job Name", value: params.jobName },
    { title: "Status", value: "Timeout" },
    { title: "Duration", value: `${params.duration} seconds` },
  ];

  if (params.runId) {
    fields.push({ title: "Run ID", value: params.runId });
  }

  if (params.dashboardUrl) {
    fields.push({ title: "🔗 Job Details", value: params.dashboardUrl });
  }

  return renderFn({
    title: `Job Timeout - ${params.jobName}`,
    message: `Job "${params.jobName}" timed out after ${params.duration} seconds. No ping received within expected interval.`,
    fields,
    footer: "Supercheck Job Monitoring",
    type: "warning",
    color: COLOR_WARNING,
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

  try {
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
  } catch (error) {
    console.error(
      "[Email Template Processor] Failed to initialize:",
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - let the app continue but log so operators know templates won't work
  }
}


/**
 * Auto-initialize processor on app startup (server-side only)
 * This ensures the BullMQ worker is always running to process email template jobs
 * CRITICAL: Must run at module level because worker needs templates even when no user is logged in
 */
if (typeof window === "undefined") {
  // Only initialize on server-side
  const initPromise = initializeEmailTemplateProcessor();
  initPromise.catch((err) => {
    console.error(
      "[Email Template Processor] Auto-initialization failed - email templates may fall back to simple HTML:",
      err instanceof Error ? err.message : String(err)
    );
  });
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

/**
 * Generate fallback email HTML and text using simple template matching the current design
 * This ensures emails are always sent even if React Email rendering fails
 */
function generateFallbackEmail(template: string, data: EmailTemplateData): RenderedEmailResult {
  const config = getTemplateConfig(template, data);
  const html = generateFallbackHTML(template, data);
  const text = generateFallbackText(template, data);
  
  return {
    subject: config.title,
    html,
    text,
  };
}

// Export the fallback function for testing
export { generateFallbackEmail };

/**
 * Generate fallback HTML matching the simple email design
 */
function generateFallbackHTML(template: string, data: EmailTemplateData): string {
  const config = getTemplateConfig(template, data);
  
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <title>${config.title}</title>
</head>
<body style="background-color: #f5f5f5; margin: 0; padding: 20px; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border: 1px solid #e0e0e0; border-radius: 4px;">
          <!-- Header -->
          <tr>
            <td style="background-color: ${config.color}; padding: 20px; text-align: center;">
              <h1 style="color: #ffffff; font-size: 24px; font-weight: normal; margin: 0;">Supercheck Notification</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 20px;">
              <h2 style="color: #333333; font-size: 18px; font-weight: normal; margin: 0 0 20px 0;">${config.title}</h2>
              
              ${config.message ? `
              <table width="100%" border="0" cellspacing="0" cellpadding="15" style="background-color: #fafafa; border-left: 4px solid ${config.color}; margin-bottom: 20px;">
                <tr>
                  <td style="color: #333333; font-size: 14px; line-height: 1.5;">
                    ${config.message}
                  </td>
                </tr>
              </table>
              ` : ''}
              
              ${config.fields.length > 0 ? `
              <table width="100%" border="0" cellspacing="0" cellpadding="12" style="border: 1px solid #e0e0e0; margin-bottom: 20px;">
                ${config.fields.map(field => `
                <tr>
                  <td width="30%" style="background-color: #f8f9fa; color: #666666; font-size: 14px; font-weight: normal; border-bottom: 1px solid #e0e0e0; padding: 12px; vertical-align: top;">
                    ${field.title}
                  </td>
                  <td width="70%" style="color: #333333; font-size: 14px; border-bottom: 1px solid #e0e0e0; padding: 12px; vertical-align: top;">
                    ${escapeHtml(field.value)}
                  </td>
                </tr>
                `).join('')}
              </table>
              ` : ''}
              
              ${config.footer ? `
              <p style="color: #666666; font-size: 12px; margin: 20px 0 0 0;">
                ${config.footer}
              </p>
              ` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generate fallback plain text version
 */
function generateFallbackText(template: string, data: EmailTemplateData): string {
  const config = getTemplateConfig(template, data);
  
  let text = `${config.title}\n`;
  text += `${'='.repeat(config.title.length)}\n\n`;
  
  if (config.message) {
    text += `${config.message}\n\n`;
  }
  
  if (config.fields.length > 0) {
    text += 'Details:\n';
    text += '--------\n';
    config.fields.forEach(field => {
      text += `${field.title}: ${field.value}\n`;
    });
    text += '\n';
  }
  
  if (config.footer) {
    text += `${config.footer}\n`;
  }
  
  return text;
}

/**
 * Get template configuration for fallback generation
 */
function getTemplateConfig(template: string, data: EmailTemplateData): {
  title: string;
  message: string;
  color: string;
  fields: Array<{ title: string; value: string }>;
  footer: string;
} {
  switch (template) {
    case "monitor-alert":
      const type = (data.type as "failure" | "success" | "warning") || "failure";
      const color = type === 'success' ? COLOR_SUCCESS : type === 'warning' ? COLOR_WARNING : COLOR_FAILURE;
      
      return {
        title: data.title || "Monitor Alert",
        message: data.message || "",
        color: color,
        fields: data.fields || [],
        footer: data.footer || "Supercheck Monitoring System",
      };

    case "job-failure":
      return {
        title: `Job Failed - ${data.jobName || "Unknown Job"}`,
        message: `Job "${data.jobName || "Unknown Job"}" has failed. Please review the details below.`,
        color: COLOR_FAILURE,
        fields: [
          { title: "Job Name", value: data.jobName || "Unknown Job" },
          { title: "Status", value: "Failed" },
          { title: "Duration", value: `${data.duration || 0} seconds` },
          ...(data.errorMessage ? [{ title: "Error", value: data.errorMessage }] : []),
          ...(data.runId ? [{ title: "Run ID", value: data.runId }] : []),
          ...(data.dashboardUrl ? [{ title: "🔗 Job Details", value: data.dashboardUrl }] : []),
        ],
        footer: "Supercheck Job Monitoring",
      };

    case "job-success":
      return {
        title: `Job Completed - ${data.jobName || "Unknown Job"}`,
        message: `Job "${data.jobName || "Unknown Job"}" has completed successfully.`,
        color: COLOR_SUCCESS,
        fields: [
          { title: "Job Name", value: data.jobName || "Unknown Job" },
          { title: "Status", value: "Success" },
          { title: "Duration", value: `${data.duration || 0} seconds` },
          ...(data.runId ? [{ title: "Run ID", value: data.runId }] : []),
          ...(data.dashboardUrl ? [{ title: "🔗 Job Details", value: data.dashboardUrl }] : []),
        ],
        footer: "Supercheck Job Monitoring",
      };

    case "job-timeout":
      return {
        title: `Job Timeout - ${data.jobName || "Unknown Job"}`,
        message: `Job "${data.jobName || "Unknown Job"}" timed out after ${data.duration || 0} seconds. No ping received within expected interval.`,
        color: COLOR_WARNING,
        fields: [
          { title: "Job Name", value: data.jobName || "Unknown Job" },
          { title: "Status", value: "Timeout" },
          { title: "Duration", value: `${data.duration || 0} seconds` },
          ...(data.runId ? [{ title: "Run ID", value: data.runId }] : []),
          ...(data.dashboardUrl ? [{ title: "🔗 Job Details", value: data.dashboardUrl }] : []),
        ],
        footer: "Supercheck Job Monitoring",
      };

    case "password-reset":
      return {
        title: "Password Reset Request",
        message: "You requested to reset your password. Click the link below to reset it.",
        color: COLOR_INFO,
        fields: [
          { title: "Reset Link", value: data.resetUrl || "" },
          { title: "Email", value: data.userEmail || "" },
        ],
        footer: "This link will expire in 1 hour for security reasons.",
      };

    case "organization-invitation":
      return {
        title: `Invitation to Join ${data.organizationName || "Organization"}`,
        message: `You've been invited to join ${data.organizationName || "an organization"}`,
        color: COLOR_INFO,
        fields: [
          { title: "Organization", value: data.organizationName || "" },
          { title: "Role", value: data.role || "Member" },
          ...(data.projectInfo ? [{ title: "Project", value: data.projectInfo }] : []),
        ],
        footer: "Click the invitation link to accept and join the organization.",
      };

    case "status-page-verification":
      return {
        title: "Verify Your Status Page",
        message: `Please verify your ownership of ${data.statusPageName || "your status page"}`,
        color: COLOR_INFO,
        fields: [
          { title: "Status Page", value: data.statusPageName || "" },
          { title: "Verification URL", value: data.verificationUrl || "" },
        ],
        footer: "Click the verification link to prove ownership of your status page.",
      };

    case "status-page-welcome":
      return {
        title: `Welcome to ${data.statusPageName || "Your Status Page"}`,
        message: "Your status page has been successfully created and is ready to use.",
        color: COLOR_SUCCESS,
        fields: [
          { title: "Status Page", value: data.statusPageName || "" },
          { title: "Status Page URL", value: data.statusPageUrl || "" },
        ],
        footer: data.unsubscribeUrl 
          ? `Unsubscribe: ${data.unsubscribeUrl}` 
          : "Manage your notification preferences in your account settings.",
      };

    case "incident-notification":
      return {
        title: `Incident ${data.incidentStatus || "Update"}: ${data.incidentName || "System Incident"}`,
        message: data.incidentDescription || "An incident has been reported.",
        color: data.incidentStatus === "resolved" ? COLOR_SUCCESS : COLOR_FAILURE,
        fields: [
          { title: "Incident", value: data.incidentName || "" },
          { title: "Status", value: data.incidentStatus || "" },
          { title: "Impact", value: data.incidentImpact || "" },
          { title: "Affected Components", value: (data.affectedComponents || []).join(", ") },
          { title: "Last Updated", value: new Date(data.updateTimestamp || Date.now()).toLocaleString() },
        ],
        footer: `Visit ${data.statusPageUrl || "your status page"} for more details.`,
      };

    case "test-email":
      return {
        title: "Supercheck Test Email",
        message: data.testMessage || "This is a test email from Supercheck to verify your email configuration.",
        color: COLOR_SUCCESS,
        fields: [],
        footer: "If you received this email, your notification system is working correctly.",
      };

    default:
      return {
        title: "Supercheck Notification",
        message: "A notification has been sent from Supercheck.",
        color: COLOR_INFO,
        fields: Object.entries(data).map(([key, value]) => ({
          title: key.charAt(0).toUpperCase() + key.slice(1),
          value: String(value),
        })),
        footer: "Supercheck Notification System",
      };
  }
}

/**
 * Escape HTML characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  
  return text.replace(/[&<>"']/g, (m) => map[m]);
}
