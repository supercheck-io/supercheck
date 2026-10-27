import { Injectable, Logger } from '@nestjs/common';
import { render } from '@react-email/render';
import { MonitorAlertEmail } from '../emails/monitor-alert';

/**
 * Email Template Service
 *
 * Renders alert emails locally with React Email (templates are byte-identical
 * copies of app/src/emails, kept in sync by app/scripts/sync-email-templates.mjs).
 * No queue, no Redis, no dependency on the app being up. If rendering ever
 * throws, a basic escaped HTML/text email is returned so an alert is never dropped.
 */

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type AlertType = 'failure' | 'success' | 'warning';
type Field = { title: string; value: string };

interface AlertParams {
  title: string;
  message: string;
  fields: Field[];
  footer: string;
  type: AlertType;
  color: string;
  /** Absolute app origin; enables the "View incidents" button on failure emails. */
  appUrl?: string;
}

// Same colors the app-side processor used, so emails look unchanged.
const COLOR_SUCCESS = '#10b981';
const COLOR_FAILURE = '#dc2626';
const COLOR_WARNING = '#f59e0b';
const JOB_FOOTER = 'Supercheck Job Monitoring';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);

  async renderMonitorAlertEmail(params: AlertParams): Promise<RenderedEmail> {
    try {
      const component = MonitorAlertEmail({
        title: params.title,
        message: params.message,
        fields: params.fields,
        footer: params.footer,
        type: params.type,
        color: params.color,
        incidentsUrl: this.incidentsUrl(params.appUrl),
      });
      return {
        subject: params.title,
        html: await render(component, { pretty: false }),
        text: await render(component, { plainText: true }),
      };
    } catch (error) {
      this.logger.error(
        `React Email render failed for "${params.title}", using basic fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallback(params);
    }
  }

  async renderJobFailureEmail(params: {
    jobName: string;
    duration: number;
    errorMessage?: string;
    runId?: string;
    dashboardUrl?: string;
    appUrl?: string;
  }): Promise<RenderedEmail> {
    const fields: Field[] = [
      { title: 'Job Name', value: params.jobName },
      { title: 'Status', value: 'Failed' },
      { title: 'Duration', value: `${params.duration} seconds` },
    ];
    if (params.errorMessage) {
      fields.push({ title: 'Error', value: params.errorMessage });
    }
    this.pushRunFields(fields, params);
    return this.renderMonitorAlertEmail({
      title: `Job Failed - ${params.jobName}`,
      message: `Job "${params.jobName}" has failed. Please review the details below.`,
      fields,
      footer: JOB_FOOTER,
      type: 'failure',
      color: COLOR_FAILURE,
      appUrl: params.appUrl,
    });
  }

  async renderJobSuccessEmail(params: {
    jobName: string;
    duration: number;
    runId?: string;
    dashboardUrl?: string;
    appUrl?: string;
  }): Promise<RenderedEmail> {
    const fields: Field[] = [
      { title: 'Job Name', value: params.jobName },
      { title: 'Status', value: 'Success' },
      { title: 'Duration', value: `${params.duration} seconds` },
    ];
    this.pushRunFields(fields, params);
    return this.renderMonitorAlertEmail({
      title: `Job Completed - ${params.jobName}`,
      message: `Job "${params.jobName}" has completed successfully.`,
      fields,
      footer: JOB_FOOTER,
      type: 'success',
      color: COLOR_SUCCESS,
    });
  }

  async renderJobTimeoutEmail(params: {
    jobName: string;
    duration: number;
    runId?: string;
    dashboardUrl?: string;
    appUrl?: string;
  }): Promise<RenderedEmail> {
    const fields: Field[] = [
      { title: 'Job Name', value: params.jobName },
      { title: 'Status', value: 'Timeout' },
      { title: 'Duration', value: `${params.duration} seconds` },
    ];
    this.pushRunFields(fields, params);
    return this.renderMonitorAlertEmail({
      title: `Job Timeout - ${params.jobName}`,
      message: `Job "${params.jobName}" timed out after ${params.duration} seconds. No ping received within expected interval.`,
      fields,
      footer: JOB_FOOTER,
      type: 'warning',
      color: COLOR_WARNING,
      appUrl: params.appUrl,
    });
  }

  /** Local rendering has no external dependency, so it is always healthy. */
  healthCheck(): { healthy: boolean; message: string } {
    return { healthy: true, message: 'Email templates render locally' };
  }

  private pushRunFields(
    fields: Field[],
    p: { runId?: string; dashboardUrl?: string },
  ): void {
    if (p.runId) fields.push({ title: 'Run ID', value: p.runId });
    if (p.dashboardUrl) {
      fields.push({ title: '🔗 Job Details', value: p.dashboardUrl });
    }
  }

  private incidentsUrl(appUrl?: string): string | undefined {
    return appUrl ? `${appUrl.replace(/\/+$/, '')}/incidents` : undefined;
  }

  private fallback(params: AlertParams): RenderedEmail {
    const rows = params.fields
      .map(
        (f) =>
          `<tr><td style="padding:6px 12px;color:#6b7280"><b>${escapeHtml(f.title)}</b></td><td style="padding:6px 12px">${escapeHtml(f.value)}</td></tr>`,
      )
      .join('');
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:${escapeHtml(params.color)};color:#fff;padding:20px"><h2 style="margin:0">${escapeHtml(params.title)}</h2></div><div style="padding:20px"><p>${escapeHtml(params.message)}</p><table>${rows}</table><p style="color:#6b7280;font-size:12px">${escapeHtml(params.footer)}</p></div></body></html>`;
    const text = [
      params.title,
      '',
      params.message,
      '',
      ...params.fields.map((f) => `${f.title}: ${f.value}`),
      '',
      params.footer,
    ].join('\n');
    return { subject: params.title, html, text };
  }
}
