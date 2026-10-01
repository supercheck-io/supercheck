import nodemailer, { type Transporter } from "nodemailer";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MultiRecipientEmailOptions {
  recipients: string[];
  subject: string;
  text: string;
  html: string;
}

export interface MultiRecipientResult {
  sentCount: number;
  failedAddresses: string[];
  errors: Record<string, string>;
}

type SmtpConfigError = { error: string };

function buildSmtpTransporter(): Transporter | SmtpConfigError {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = process.env.SMTP_SECURE === "true";
  const hasSmtpUser = Boolean(smtpUser);
  const hasSmtpPassword = Boolean(smtpPassword);

  if (!smtpHost) {
    return { error: "SMTP not configured (missing environment variable: SMTP_HOST)" };
  }
  if (hasSmtpUser !== hasSmtpPassword) {
    return { error: "SMTP authentication is partially configured (set both SMTP_USER and SMTP_PASSWORD, or leave both unset)" };
  }
  if (!process.env.SMTP_FROM_EMAIL) {
    return { error: "SMTP sender not configured (missing SMTP_FROM_EMAIL)" };
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    ...(hasSmtpUser && hasSmtpPassword
      ? { auth: { user: smtpUser, pass: smtpPassword } }
      : {}),
    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2" as const, // Required for ZeptoMail and security best practices
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
  });
}

function isSmtpConfigError(value: Transporter | SmtpConfigError): value is SmtpConfigError {
  return "error" in value;
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
   * Send a single email via SMTP.
   */
  async sendEmail(
    options: EmailOptions
  ): Promise<{ success: boolean; message: string; error?: string }> {
    const transporterOrError = buildSmtpTransporter();
    if (isSmtpConfigError(transporterOrError)) {
      return { success: false, message: "", error: transporterOrError.error };
    }

    const transporter = transporterOrError;
    const fromEmail = process.env.SMTP_FROM_EMAIL!;

    try {
      await transporter.verify();
      await transporter.sendMail({
        from: fromEmail,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return { success: true, message: "Email sent successfully via SMTP" };
    } catch (error) {
      return {
        success: false,
        message: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Send the same email to multiple recipients sequentially using a single SMTP
   * connection. Returns per-address success/failure so callers can report
   * partial delivery (e.g. one bad address doesn't block the rest).
   */
  async sendEmailToMultiple(
    options: MultiRecipientEmailOptions
  ): Promise<MultiRecipientResult> {
    const transporterOrError = buildSmtpTransporter();
    if (isSmtpConfigError(transporterOrError)) {
      return {
        sentCount: 0,
        failedAddresses: [...options.recipients],
        errors: Object.fromEntries(
          options.recipients.map((r) => [r, transporterOrError.error])
        ),
      };
    }

    const transporter = transporterOrError;
    const fromEmail = process.env.SMTP_FROM_EMAIL!;

    try {
      await transporter.verify();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        sentCount: 0,
        failedAddresses: [...options.recipients],
        errors: Object.fromEntries(options.recipients.map((r) => [r, msg])),
      };
    }

    let sentCount = 0;
    const failedAddresses: string[] = [];
    const errors: Record<string, string> = {};

    for (const recipient of options.recipients) {
      try {
        await transporter.sendMail({
          from: fromEmail,
          to: recipient,
          subject: options.subject,
          text: options.text,
          html: options.html,
        });
        sentCount++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        failedAddresses.push(recipient);
        errors[recipient] = msg;
      }
    }

    return { sentCount, failedAddresses, errors };
  }
}
