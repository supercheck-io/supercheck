import { EmailService } from "@/lib/email-service";
import { renderExistingAccountEmail } from "@/lib/email-renderer";
import { checkEmailVerificationRateLimit, getClientIP } from "@/lib/session-security";
import { parseInviteToken } from "@/lib/validations/auth";

function appOrigin(request: Request | undefined): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL;
  return (configured || (request ? new URL(request.url).origin : "")).replace(/\/+$/, "");
}

/**
 * Better Auth answers a sign-up for an existing address with a generic success (anti-enumeration),
 * so the visitor is told to check their email. This is the email they get: a sign-in link that
 * keeps the invitation, so "Check your email" is true for new and existing users alike.
 *
 * Shares the verification-email rate limits (per address and per IP), so it cannot send more
 * often than a normal sign-up could. Never throws: the sign-up response must not depend on it.
 */
export async function sendExistingAccountNotice(
  { user }: { user: { email: string } },
  request?: Request,
): Promise<void> {
  try {
    if (!(await checkEmailVerificationRateLimit(user.email)).allowed) return;
    const clientIP = request ? getClientIP(request.headers) : "unknown";
    if (clientIP !== "unknown" && !(await checkEmailVerificationRateLimit(clientIP)).allowed) return;

    const inviteToken = parseInviteToken(request?.headers.get("x-invite-token")?.trim() ?? null);
    const origin = appOrigin(request);
    const content = await renderExistingAccountEmail({
      signInUrl: `${origin}/sign-in${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ""}`,
      resetUrl: `${origin}/forgot-password`,
      userEmail: user.email,
    });
    const result = await EmailService.getInstance().sendEmail({
      to: user.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    if (!result.success) console.error("Failed to send existing-account email:", result.error);
  } catch (error) {
    console.error("Error sending existing-account email:", error);
  }
}
