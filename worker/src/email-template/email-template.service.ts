import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Email Template Service
 *
 * This service fetches rendered email templates from the centralized Next.js email API.
 * It provides retry logic, caching, and fallback mechanisms for reliability.
 */

interface EmailTemplateResponse {
  success: boolean;
  html?: string;
  text?: string;
  subject?: string;
  error?: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

@Injectable()
export class EmailTemplateService {
  private readonly logger = new Logger(EmailTemplateService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly cache = new Map<string, { data: RenderedEmail; timestamp: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 1000; // 1 second

  constructor(private configService: ConfigService) {
    this.apiUrl = this.configService.get<string>('APP_URL') || 'http://localhost:3000';
    this.apiKey = this.configService.get<string>('EMAIL_API_KEY') || 'internal-email-service-key';
  }

  /**
   * Render a monitor alert email template
   */
  async renderMonitorAlertEmail(params: {
    title: string;
    message: string;
    fields: Array<{ title: string; value: string }>;
    footer: string;
    type: 'failure' | 'success' | 'warning';
    color: string;
  }): Promise<RenderedEmail> {
    return this.fetchTemplate('monitor-alert', params);
  }

  /**
   * Generic method to fetch any email template from the API
   */
  private async fetchTemplate(
    template: string,
    data: Record<string, any>,
  ): Promise<RenderedEmail> {
    const cacheKey = this.getCacheKey(template, data);

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      this.logger.debug(`Using cached template for ${template}`);
      return cached;
    }

    // Fetch from API with retries
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        this.logger.debug(`Fetching template ${template} (attempt ${attempt}/${this.MAX_RETRIES})`);

        const response = await fetch(`${this.apiUrl}/api/emails/render`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify({ template, data }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            `API responded with ${response.status}: ${errorData.error || response.statusText}`,
          );
        }

        const result: EmailTemplateResponse = await response.json();

        if (!result.success || !result.html || !result.text) {
          throw new Error(`Invalid response from email API: ${result.error || 'Missing required fields'}`);
        }

        const rendered: RenderedEmail = {
          subject: result.subject || 'Notification',
          html: result.html,
          text: result.text,
        };

        // Cache the result
        this.setCache(cacheKey, rendered);

        return rendered;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(
          `Failed to fetch template ${template} (attempt ${attempt}/${this.MAX_RETRIES}): ${lastError.message}`,
        );

        // Wait before retrying (exponential backoff)
        if (attempt < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY * attempt);
        }
      }
    }

    // All retries failed, use fallback
    this.logger.error(
      `Failed to fetch template ${template} after ${this.MAX_RETRIES} attempts. Using fallback. Error: ${lastError?.message}`,
    );

    return this.getFallbackEmail(template, data);
  }

  /**
   * Fallback email generation when API is unavailable
   */
  private getFallbackEmail(template: string, data: Record<string, any>): RenderedEmail {
    this.logger.warn(`Using fallback email for template: ${template}`);

    switch (template) {
      case 'monitor-alert':
        return {
          subject: data.title || 'Monitor Alert',
          text: this.generateFallbackText(data),
          html: this.generateFallbackHTML(data),
        };
      default:
        return {
          subject: 'Notification',
          text: JSON.stringify(data, null, 2),
          html: `<pre>${JSON.stringify(data, null, 2)}</pre>`,
        };
    }
  }

  /**
   * Generate fallback plain text email for monitor alerts
   */
  private generateFallbackText(data: any): string {
    const lines = [
      'SUPERCHECK MONITORING ALERT',
      '',
      data.title || 'Alert',
      '',
      data.message || '',
      '',
      'ALERT DETAILS:',
    ];

    if (data.fields && Array.isArray(data.fields)) {
      data.fields.forEach((field: any) => {
        lines.push(`${field.title}: ${field.value}`);
      });
    }

    lines.push('');
    lines.push(data.footer || 'Supercheck Monitoring System');
    lines.push('');
    lines.push('This is an automated notification from your monitoring system.');

    return lines.join('\n');
  }

  /**
   * Generate fallback HTML email for monitor alerts
   */
  private generateFallbackHTML(data: any): string {
    const fieldsHtml = data.fields && Array.isArray(data.fields)
      ? data.fields
          .map(
            (field: any) => `
            <tr>
              <td style="padding: 8px; font-weight: bold; border-bottom: 1px solid #ddd;">
                ${this.escapeHtml(field.title)}:
              </td>
              <td style="padding: 8px; border-bottom: 1px solid #ddd;">
                ${this.escapeHtml(field.value)}
              </td>
            </tr>
          `,
          )
          .join('')
      : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f44336; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0;">
            <h1 style="margin: 0;">Supercheck Monitoring Alert</h1>
          </div>
          <div style="background: #fff; padding: 20px; border: 1px solid #ddd; border-top: none;">
            <h2 style="margin-top: 0;">${this.escapeHtml(data.title || 'Alert')}</h2>
            <div style="background: #f9f9f9; padding: 15px; border-left: 4px solid ${this.escapeHtml(data.color || '#f44336')}; margin: 20px 0;">
              <p style="margin: 0;">${this.escapeHtml(data.message || '')}</p>
            </div>
            <h3>Alert Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              ${fieldsHtml}
            </table>
          </div>
          <div style="background: #f5f5f5; padding: 15px; text-align: center; border-radius: 0 0 5px 5px; font-size: 12px; color: #666;">
            <p style="margin: 0;">${this.escapeHtml(data.footer || 'Supercheck Monitoring System')}</p>
            <p style="margin: 5px 0 0;">This is an automated notification from your monitoring system.</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Escape HTML to prevent XSS in fallback emails
   */
  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return String(text).replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Cache management
   */
  private getCacheKey(template: string, data: Record<string, any>): string {
    return `${template}:${JSON.stringify(data)}`;
  }

  private getFromCache(key: string): RenderedEmail | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  private setCache(key: string, data: RenderedEmail): void {
    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Utility: Sleep for a given number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Health check: Test connection to email API
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/emails/render`, {
        method: 'GET',
        headers: {
          'x-api-key': this.apiKey,
        },
      });

      if (response.ok) {
        return { healthy: true, message: 'Email template API is reachable' };
      }

      return {
        healthy: false,
        message: `Email template API returned ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Cannot reach email template API: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
