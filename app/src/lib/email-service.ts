import nodemailer from "nodemailer";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export class EmailService {
  private static instance: EmailService;

  public static getInstance(): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService();
    }
    return EmailService.instance;
  }

  /**
   * Send email using SMTP
   */
  async sendEmail(options: EmailOptions): Promise<{ success: boolean; message: string; error?: string }> {
    return await this.sendViaSMTP(options);
  }

  private async sendViaSMTP(options: EmailOptions): Promise<{ success: boolean; message: string; error?: string }> {
    try {
      // SMTP configuration from environment variables
      const smtpHost = process.env.SMTP_HOST;
      const smtpPort = parseInt(process.env.SMTP_PORT || '587');
      const smtpUser = process.env.SMTP_USER;
      const smtpPassword = process.env.SMTP_PASSWORD;
      const smtpSecure = process.env.SMTP_SECURE === 'true';
      const fromEmail = process.env.SMTP_FROM_EMAIL;

      // Validate SMTP configuration
      if (!smtpHost || !smtpUser || !smtpPassword || !fromEmail) {
        return {
          success: false,
          message: '',
          error: 'SMTP not configured (missing environment variables: SMTP_HOST, SMTP_USER, SMTP_PASSWORD, SMTP_FROM_EMAIL)'
        };
      }

      // Create SMTP transporter
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPassword,
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 10000,
        greetingTimeout: 5000,
      });

      // Send email with configured from address
      await transporter.sendMail({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      return {
        success: true,
        message: 'Email sent successfully via SMTP'
      };
    } catch (error) {
      return {
        success: false,
        message: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}