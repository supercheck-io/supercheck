import { Injectable, Logger } from '@nestjs/common';
import { render } from '@react-email/render';
import { MonitorAlertEmail, alertEmailSubject } from '../emails/monitor-alert';
import { PALETTE } from '../emails/palette';
import { PLAIN_TEXT_RENDER_OPTIONS } from '../emails/base-layout';

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

type AlertType = 'failure' | 'success' | 'recovery' | 'warning' | 'info';
type Field = { title: string; value: string };

interface AlertParams {
  title: string;
  message: string;
  fields: Field[];
  footer: string;
  type: AlertType;
  /** Absolute app origin; enables the "View incidents" button on failure emails. */
  appUrl?: string;
}

/** 1s, 59s, 1m 05s, 1h 02m. */
export const formatDuration = (totalSeconds: number): string => {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};

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
        incidentsUrl: this.incidentsUrl(params.appUrl),
      });
      return {
        subject: alertEmailSubject(params.title),
        html: await render(component, { pretty: false }),
        text: await render(component, PLAIN_TEXT_RENDER_OPTIONS),
      };
    } catch (error) {
      this.logger.error(
        `React Email render failed for "${params.title}", using basic fallback: ${error instanceof Error ? error.message : String(error)}`,
      );
      return this.fallback(params);
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
    const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:${PALETTE[params.type === 'recovery' ? 'success' : params.type]};color:#fff;padding:20px"><h2 style="margin:0">${escapeHtml(params.title)}</h2></div><div style="padding:20px"><p>${escapeHtml(params.message)}</p><table>${rows}</table><p style="color:#6b7280;font-size:12px">${escapeHtml(params.footer)}</p></div></body></html>`;
    const text = [
      params.title,
      '',
      params.message,
      '',
      ...params.fields.map((f) => `${f.title}: ${f.value}`),
      '',
      params.footer,
    ].join('\n');
    return { subject: alertEmailSubject(params.title), html, text };
  }
}
