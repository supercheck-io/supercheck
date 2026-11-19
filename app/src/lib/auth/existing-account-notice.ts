import { EmailService } from "@/lib/email-service";
import { renderExistingAccountEmail } from "@/lib/email-renderer";
import { eq } from "drizzle-orm";
import { db } from "@/utils/db";
import { invitation } from "@/db/schema";
import { checkEmailVerificationRateLimit, checkExistingAccountNoticeRateLimit, getClientIP } from "@/lib/session-security";
import { parseInviteToken } from "@/lib/validations/auth";

// Configured origin only: a request's own URL follows the Host header and must not end up in a link.
function appOrigin(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "").replace(/\/+$/, "");
}

// The header is attacker-controlled: only echo a token whose pending invitation is for this address.
async function inviteTokenFor(email: string, header: string | null | undefined): Promise<string | null> {
  const token = parseInviteToken(header?.trim() ?? null);
  if (!token) return null;
  const [row] = await db
    .select({ email: invitation.email, status: invitation.status, expiresAt: invitation.expiresAt })
    .from(invitation)
    .where(eq(invitation.id, token))
    .limit(1);
  const matches =
    row && row.status === "pending" && row.expiresAt > new Date() && row.email.toLowerCase().trim() === email.toLowerCase().trim();
  return matches ? token : null;
}

/**
 * Better Auth answers a sign-up for an existing address with a generic success (anti-enumeration),
 * so the visitor is told to check their email. This is the email they get: a sign-in link that
 * keeps the invitation, so "Check your email" is true for new and existing users alike.
 *
 * Limited per address (its own counter, so it cannot drain the real verification resends) and per
 * IP. Silent when limited: the sign-up answer stays the same generic success. Never throws.
 */
export async function sendExistingAccountNotice(
  { user }: { user: { email: string } },
  request?: Request,
): Promise<void> {
  try {
    // IP first: a limited IP must not burn the address's single slot.
    const clientIP = request ? getClientIP(request.headers) : "unknown";
    if (clientIP !== "unknown" && !(await checkEmailVerificationRateLimit(clientIP)).allowed) return;
    if (!(await checkExistingAccountNoticeRateLimit(user.email)).allowed) return;

    const inviteToken = await inviteTokenFor(user.email, request?.headers.get("x-invite-token"));
    const origin = appOrigin();
    if (!origin) return console.error("Cannot email an existing account: no app URL configured");
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
