import nodemailer, { type Transporter } from "nodemailer";
import { isUndeliverableRecipient } from "@/lib/email-recipient-policy";

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
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
  /** On a domain that cannot receive mail; never handed to SMTP. */
  skippedAddresses: string[];
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
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
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
    socketTimeout: 30000,
  });
}

/**
 * From/Reply-To for every message. SMTP_FROM_NAME adds a display name unless
 * SMTP_FROM_EMAIL already carries one ("Name <a@b.c>"); SMTP_REPLY_TO is optional.
 */
export function smtpSender(env: NodeJS.ProcessEnv = process.env): {
  from: string | { name: string; address: string };
  replyTo?: string;
} {
  const address = env.SMTP_FROM_EMAIL!;
  const name = env.SMTP_FROM_NAME?.trim();
  return {
    from: name && !address.includes("<") ? { name, address } : address,
    ...(env.SMTP_REPLY_TO?.trim() ? { replyTo: env.SMTP_REPLY_TO.trim() } : {}),
  };
}

function isSmtpConfigError(value: Transporter | SmtpConfigError): value is SmtpConfigError {
  return "error" in value;
}

export class EmailService {
  private static instance: EmailService;
  private transporter?: Transporter;

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
    // Reserved/blocked domains only bounce (and bounces get the SMTP account blocked); treat as done.
    if (isUndeliverableRecipient(options.to)) {
      return { success: true, message: "Skipped: recipient domain does not accept email" };
    }
    const transporterOrError = this.transporter ?? buildSmtpTransporter();
    if (isSmtpConfigError(transporterOrError)) {
      return { success: false, message: "", error: transporterOrError.error };
    }

    const transporter = transporterOrError;
    this.transporter = transporter;
    const sender = smtpSender();

    try {
      await transporter.sendMail({
        ...sender,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        headers: options.headers,
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
    // Reserved/blocked domains are skipped: neither sent nor failed, so callers don't retry them.
    const deliverable = options.recipients.filter((r) => !isUndeliverableRecipient(r));
    const skippedAddresses = options.recipients.filter((r) => isUndeliverableRecipient(r));
    if (deliverable.length === 0) {
      return { sentCount: 0, failedAddresses: [], errors: {}, skippedAddresses };
    }
    const transporterOrError = this.transporter ?? buildSmtpTransporter();
    if (isSmtpConfigError(transporterOrError)) {
      return {
        sentCount: 0,
        failedAddresses: [...deliverable],
        errors: Object.fromEntries(
          deliverable.map((r) => [r, transporterOrError.error])
        ),
        skippedAddresses,
      };
    }

    const transporter = transporterOrError;
    this.transporter = transporter;
    const sender = smtpSender();

    try {
      await transporter.verify();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        sentCount: 0,
        failedAddresses: [...deliverable],
        errors: Object.fromEntries(deliverable.map((r) => [r, msg])),
        skippedAddresses,
      };
    }

    let sentCount = 0;
    const failedAddresses: string[] = [];
    const errors: Record<string, string> = {};

    for (const recipient of deliverable) {
      try {
        await transporter.sendMail({
          ...sender,
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

    return { sentCount, failedAddresses, errors, skippedAddresses };
  }
}
