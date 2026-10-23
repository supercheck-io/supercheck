import { betterAuth } from "better-auth";
import { loginLockoutHooks } from "@/lib/security/login-lockout-hooks";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/utils/db";
import {
  authSchema,
  oauthSchema,
  invitation,
  member,
  organization as organizationTable,
} from "@/db/schema";
import {
  organization as organizationPlugin,
  admin,
  lastLoginMethod,
  captcha,
} from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { ac, roles, Role } from "@/lib/rbac/permissions";
import { EmailService } from "@/lib/email-service";
import { revokeCredentialsAfterPasswordReset } from "@/lib/security/password-reset-cleanup";
import {
  checkPasswordResetRateLimit,
  checkEmailVerificationRateLimit,
  getClientIP,
} from "@/lib/session-security";
import {
  renderPasswordResetEmail,
  renderEmailVerificationEmail,
} from "@/lib/email-renderer";
import { nextCookies } from "better-auth/next-js";
import { getPolarPlugin } from "@/lib/auth/polar-plugin";
import {
  isCloudHosted,
  isCaptchaEnabled,
} from "@/lib/feature-flags";
import {
  getMcpResourceUrl,
  isMcpDynamicRegistrationEnabled,
  isMcpServerEnabled,
} from "@/lib/mcp/config";
import { createMcpAuthPlugins } from "@/lib/mcp/auth-plugins";
import { resolveConsentProject } from "@/lib/mcp/connect-project";

/**
 * Get CAPTCHA plugin configuration if enabled
 *
 * CAPTCHA protection is automatically enabled when TURNSTILE_SECRET_KEY is set.
 * Uses Cloudflare Turnstile in invisible mode for seamless user experience.
 *
 * Protected endpoints:
 * - /sign-in/email - Email/password sign in
 * - /sign-up/email - Email/password registration
 * - /request-password-reset - Password reset requests
 */
function getCaptchaPlugin() {
  if (!isCaptchaEnabled()) {
    return null;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  console.log(
    "[Better Auth] CAPTCHA protection enabled (Cloudflare Turnstile)",
  );

  return captcha({
    provider: "cloudflare-turnstile",
    secretKey,
    // Protect authentication endpoints from bot attacks
    endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset"],
  });
}

/**
 * OAuth 2.1 authorization server for the remote MCP server. Off unless
 * MCP_SERVER_ENABLED=true; see lib/mcp/auth-plugins.ts for the configuration.
 */
function getMcpPlugins() {
  if (!isMcpServerEnabled()) {
    return [];
  }

  return createMcpAuthPlugins({
    resource: getMcpResourceUrl(),
    dynamicRegistration: isMcpDynamicRegistrationEnabled(),
    resolveProjectReference: resolveConsentProject,
  });
}

/**
 * Rate-limits, renders and sends the password reset email. Runs off the request path
 * (see `sendResetPassword`), so it throws freely and the caller logs.
 */
async function deliverPasswordResetEmail({
  user,
  url,
  clientIP,
}: {
  user: { email: string };
  url: string;
  clientIP: string;
}): Promise<void> {
  const emailService = EmailService.getInstance();

  // Rate limit by email address
  const emailRateLimit = await checkPasswordResetRateLimit(user.email);
  if (!emailRateLimit.allowed) {
    const resetTime = emailRateLimit.resetTime ? new Date(emailRateLimit.resetTime) : new Date();
    const remainingTime = Math.ceil((resetTime.getTime() - Date.now()) / 1000 / 60);
    throw new Error(`Too many password reset attempts. Please try again in ${remainingTime} minutes.`);
  }

  // Rate limit by IP address as additional protection. An unknown address would put every such
  // request in one shared bucket that anyone could fill to block other people's resets.
  const ipRateLimit = clientIP === "unknown" ? { allowed: true } : await checkPasswordResetRateLimit(clientIP);
  if (!ipRateLimit.allowed) {
    const resetTime = "resetTime" in ipRateLimit && ipRateLimit.resetTime ? new Date(ipRateLimit.resetTime) : new Date();
    const remainingTime = Math.ceil((resetTime.getTime() - Date.now()) / 1000 / 60);
    throw new Error(
      `Too many password reset attempts from this location. Please try again in ${remainingTime} minutes.`,
    );
  }

  // Render email using react-email template
  const emailContent = await renderPasswordResetEmail({ resetUrl: url, userEmail: user.email });
  const result = await emailService.sendEmail({
    to: user.email,
    subject: emailContent.subject,
    text: emailContent.text,
    html: emailContent.html,
  });
  if (!result.success) {
    throw new Error(`Failed to send password reset email: ${result.error}`);
  }
  console.log("Password reset email sent successfully:", result.message);
}

export const auth = betterAuth({
  hooks: loginLockoutHooks,
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL,
  // Trusted origins for CORS and CSRF protection
  // In production, defaults to APP_URL and STATUS_PAGE_DOMAIN
  // Can be extended via TRUSTED_ORIGINS env var (comma-separated)
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? (() => {
          const origins: string[] = [];

          // Always include the app URL
          if (process.env.NEXT_PUBLIC_APP_URL) {
            origins.push(process.env.NEXT_PUBLIC_APP_URL);
          } else if (process.env.BETTER_AUTH_URL) {
            origins.push(process.env.BETTER_AUTH_URL);
          }

          // Add status page domain if configured
          const statusDomain = process.env.STATUS_PAGE_DOMAIN;
          if (statusDomain) {
            // Support wildcard subdomains for status pages
            origins.push(
              `https://*.${statusDomain.replace(/^https?:\/\//, "")}`,
            );
          }

          // Add any additional trusted origins from env (comma-separated)
          const additionalOrigins = process.env.TRUSTED_ORIGINS;
          if (additionalOrigins) {
            additionalOrigins
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
              .forEach((o) => origins.push(o));
          }

          return origins.length > 0 ? origins : undefined;
        })()
      : undefined,
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      enabled: !!(
        process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      enabled: !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ),
      // Get refresh token on first login and prompt for account selection
      accessType: "offline",
      prompt: "select_account consent",
    },
  },
  // Invitation acceptance requires a verified mailbox in every hosting mode.
  emailVerification: {
        sendVerificationEmail: async ({ user, url }, request) => {
          // Rate limit by email address to prevent abuse
          const emailRateLimit = await checkEmailVerificationRateLimit(
            user.email,
          );
          if (!emailRateLimit.allowed) {
            const resetTime = emailRateLimit.resetTime
              ? new Date(emailRateLimit.resetTime)
              : new Date();
            const remainingTime = Math.ceil(
              (resetTime.getTime() - Date.now()) / 1000 / 60,
            );
            throw new Error(
              `Too many verification email requests. Please try again in ${remainingTime} minutes.`,
            );
          }

          // Rate limit by IP address as additional protection
          const clientIP = request ? getClientIP(request.headers) : "unknown";
          const ipRateLimit = await checkEmailVerificationRateLimit(clientIP);
          if (!ipRateLimit.allowed) {
            const resetTime = ipRateLimit.resetTime
              ? new Date(ipRateLimit.resetTime)
              : new Date();
            const remainingTime = Math.ceil(
              (resetTime.getTime() - Date.now()) / 1000 / 60,
            );
            throw new Error(
              `Too many verification email requests from this location. Please try again in ${remainingTime} minutes.`,
            );
          }

          const emailService = EmailService.getInstance();

          // Keep the invite context only for an internal sign-in callback.
          const verificationUrl = new URL(url);
          const callbackUrl = new URL(
            verificationUrl.searchParams.get("callbackURL") || "/sign-in?verified=true",
            verificationUrl.origin,
          );
          verificationUrl.searchParams.set(
            "callbackURL",
            callbackUrl.origin === verificationUrl.origin && callbackUrl.pathname === "/sign-in"
              ? `${callbackUrl.pathname}${callbackUrl.search}`
              : "/sign-in?verified=true",
          );
          const modifiedUrl = verificationUrl.toString();

          try {
            // Render email using react-email template
            const emailContent = await renderEmailVerificationEmail({
              verificationUrl: modifiedUrl,
              userEmail: user.email,
              userName: user.name || undefined,
            });

            const result = await emailService.sendEmail({
              to: user.email,
              subject: emailContent.subject,
              text: emailContent.text,
              html: emailContent.html,
            });

            if (!result.success) {
              console.error("Failed to send verification email:", result.error);
              throw new Error("Failed to send verification email");
            }

            console.log("Verification email sent successfully to:", user.email);
          } catch (error) {
            console.error("Error sending verification email:", error);
            throw error;
          }
        },
        // Don't auto sign in - redirect to sign-in page with verified flag
        autoSignInAfterVerification: false,
      },
  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,
    // Sessions are revoked above; also end API/MCP credentials and any other pending reset link.
    onPasswordReset: async ({ user }) => {
      await revokeCredentialsAfterPasswordReset(user.id);
    },
    // Only require email verification in cloud mode
    requireEmailVerification: isCloudHosted(),
    // Better Auth answers an unknown address immediately, so a known one must not wait on
    // Redis or SMTP either: the response time would reveal which addresses have accounts.
    // Failures are logged; the caller never sees them (Better Auth swallows them anyway).
    sendResetPassword: async ({ user, url }, request) => {
      const clientIP = request ? getClientIP(request.headers) : "unknown";
      void deliverPasswordResetEmail({ user, url, clientIP }).catch((error) => {
        console.error("Error sending password reset email:", error);
      });
    },
    resetPasswordTokenExpiresIn: 3600, // 1 hour in seconds
  },
  database: drizzleAdapter(db, {
    provider: "pg", // PostgreSQL
    schema: {
      ...authSchema,
      ...oauthSchema,
      organization: organizationTable,
      member,
      invitation,
    },
  }),
  plugins: [
    // openAPI(),
    admin({
      // Use database-backed roles instead of hardcoded user IDs
      adminRoles: ["super_admin"],
      defaultRole: Role.PROJECT_VIEWER,
      ac,
      roles: {
        project_viewer: roles[Role.PROJECT_VIEWER],
        org_admin: roles[Role.ORG_ADMIN],
        super_admin: roles[Role.SUPER_ADMIN],
      },
      // Enable secure impersonation with audit trail
      impersonationSessionDuration: 60 * 60 * 24, // 1 day
    }),
    organizationPlugin({
      // Disable automatic organization creation - we handle this manually
      // Signup setup performs the only owner/project/session bootstrap.
      // Keep the generic plugin creation route disabled.
      allowUserToCreateOrganization: false,
      organizationLimit: 1,
      creatorRole: "org_owner",
      membershipLimit: 100,
      // Disable team features (we use projects instead)
      teams: {
        enabled: false,
      },
      ac,
      roles: {
        org_owner: roles[Role.ORG_OWNER],
        org_admin: roles[Role.ORG_ADMIN],
        project_admin: roles[Role.PROJECT_ADMIN],
        project_editor: roles[Role.PROJECT_EDITOR],
        project_viewer: roles[Role.PROJECT_VIEWER],
      },
      // Note: Invitation emails are handled by the API route at:
      // /app/src/app/api/organizations/members/invite/route.ts
      // This route provides comprehensive invitation functionality including:
      // - Email sending with proper HTML templates
      // - Rate limiting (max 10 invites per hour)
      // - Project access management
      // - Audit logging
      // - Error handling and validation
      //
      // The Better Auth plugin's sendInvitationEmail is not used since the API route
      // provides a more complete implementation with additional features.
    }),
    apiKey(),
    // Track last login method for better UX (shows "Last used" badge)
    lastLoginMethod(),
    // Conditionally add Polar plugin if enabled
    ...(() => {
      const polarPlugin = getPolarPlugin();
      return polarPlugin ? [polarPlugin] : [];
    })(),
    // Conditionally add CAPTCHA plugin if enabled (Cloudflare Turnstile)
    ...(() => {
      const captchaPlugin = getCaptchaPlugin();
      return captchaPlugin ? [captchaPlugin] : [];
    })(),
    // Conditionally add the MCP OAuth server (MCP_SERVER_ENABLED=true)
    ...getMcpPlugins(),
    nextCookies(),
  ],
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
    updateAge: 60 * 60 * 24,
  },
  // Note: Organization and project creation for social auth signups
  // is handled client-side by checking for new users and calling
  // /api/auth/setup-defaults from the sign-in/sign-up pages.
  // Polar customer creation is handled by /api/auth/setup-defaults
  // (NOT by the Polar plugin - createCustomerOnSignUp is disabled to prevent errors)
});
