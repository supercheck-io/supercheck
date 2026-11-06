import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';

/**
 * One pooled SMTP transporter shared by every worker email sender. It is rebuilt
 * only when the SMTP env changes, and there is no verify() round trip per send.
 */

export interface SmtpDeliveryResult {
  sentCount: number;
  failedRecipients: string[];
  errors: Record<string, string>;
}

type Sender = {
  from: string | { name: string; address: string };
  replyTo?: string;
};

type SmtpSetup =
  { error: string } | { config: SMTPPool.Options; sender: Sender };

/** Failures that mean the server is unreachable: retrying the next recipient would only wait again. */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNECTION',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKET',
  'EDNS',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'EGREETING',
  'EAUTH',
]);

export function buildSmtpSetup(
  env: NodeJS.ProcessEnv = process.env,
): SmtpSetup {
  const host = env.SMTP_HOST;
  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  const fromEmail = env.SMTP_FROM_EMAIL;
  if (!host) {
    return {
      error: 'SMTP environment variable not configured (missing SMTP_HOST)',
    };
  }
  if (Boolean(user) !== Boolean(pass)) {
    return {
      error:
        'SMTP authentication is partially configured (set both SMTP_USER and SMTP_PASSWORD, or leave both unset)',
    };
  }
  if (!fromEmail) {
    return { error: 'SMTP sender not configured (missing SMTP_FROM_EMAIL)' };
  }
  const fromName = env.SMTP_FROM_NAME?.trim();
  const replyTo = env.SMTP_REPLY_TO?.trim();
  return {
    config: {
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      host,
      port: parseInt(env.SMTP_PORT || '587'),
      secure: env.SMTP_SECURE === 'true',
      ...(user && pass ? { auth: { user, pass } } : {}),
      tls: {
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2' as const, // Required for ZeptoMail and security best practices
      },
      // Bounded: an unreachable host fails one attempt in at most ~10s.
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 30000,
    },
    sender: {
      // A display name is added only when SMTP_FROM_EMAIL is a bare address.
      from:
        fromName && !fromEmail.includes('<')
          ? { name: fromName, address: fromEmail }
          : fromEmail,
      ...(replyTo ? { replyTo } : {}),
    },
  };
}

let transporter: Transporter | undefined;
let transporterKey: string | undefined;

function getTransporter(config: SMTPPool.Options): Transporter {
  const key = JSON.stringify(config);
  if (!transporter || transporterKey !== key) {
    closeSmtpTransport();
    transporter = nodemailer.createTransport(config);
    transporterKey = key;
  }
  return transporter;
}

export function closeSmtpTransport(): void {
  try {
    transporter?.close?.();
  } catch {
    // closing a dead pool must never block shutdown
  }
  transporter = undefined;
  transporterKey = undefined;
}

/**
 * Sends one message to each recipient in turn. After the first connection-level
 * failure the remaining recipients fail immediately with the same error, so an
 * unreachable server costs one timeout per notification, not one per recipient.
 */
export async function sendMailToRecipients(
  recipients: string[],
  message: { subject: string; html: string; text: string },
  onWarn?: (msg: string) => void,
): Promise<SmtpDeliveryResult> {
  const setup = buildSmtpSetup();
  if ('error' in setup) {
    return {
      sentCount: 0,
      failedRecipients: [...recipients],
      errors: Object.fromEntries(recipients.map((r) => [r, setup.error])),
    };
  }
  const mailer = getTransporter(setup.config);
  let sentCount = 0;
  const failedRecipients: string[] = [];
  const errors: Record<string, string> = {};
  let connectionError: string | undefined;

  for (const to of recipients) {
    if (connectionError) {
      failedRecipients.push(to);
      errors[to] = connectionError;
      continue;
    }
    try {
      await mailer.sendMail({ ...setup.sender, to, ...message });
      sentCount++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onWarn?.(`SMTP delivery failed for ${to}: ${msg}`);
      failedRecipients.push(to);
      errors[to] = msg;
      const code = (error as { code?: unknown })?.code;
      if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) {
        connectionError = msg;
      }
    }
  }
  return { sentCount, failedRecipients, errors };
}
