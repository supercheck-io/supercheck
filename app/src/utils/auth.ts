import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/utils/db";
import { authSchema } from "@/db/schema";
import { apiKey, organization, admin } from "better-auth/plugins";
import { ac, roles, Role } from "@/lib/rbac/permissions";
import { EmailService } from "@/lib/email-service";
import {
  checkPasswordResetRateLimit,
  getClientIP,
} from "@/lib/session-security";
import { renderPasswordResetEmail } from "@/lib/email-renderer";

import { nextCookies } from "better-auth/next-js";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins:
    process.env.NODE_ENV === "production"
      ? [
          process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL!,
          // Add status page domain for wildcard subdomains
          process.env.STATUS_PAGE_DOMAIN || "supercheck.io",
          // Add wildcard pattern for all subdomains
          "https://*.supercheck.io",
          "https://*.demo.supercheck.io",
        ]
      : undefined,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, url }, request) => {
      const emailService = EmailService.getInstance();

      // Extract IP from request for rate limiting
      const clientIP = request ? getClientIP(request.headers) : "unknown";

      // Rate limit by email address
      const emailRateLimit = checkPasswordResetRateLimit(user.email);
      if (!emailRateLimit.allowed) {
        const resetTime = emailRateLimit.resetTime
          ? new Date(emailRateLimit.resetTime)
          : new Date();
        const remainingTime = Math.ceil(
          (resetTime.getTime() - Date.now()) / 1000 / 60
        );
        throw new Error(
          `Too many password reset attempts. Please try again in ${remainingTime} minutes.`
        );
      }

      // Rate limit by IP address as additional protection
      const ipRateLimit = checkPasswordResetRateLimit(clientIP);
      if (!ipRateLimit.allowed) {
        const resetTime = ipRateLimit.resetTime
          ? new Date(ipRateLimit.resetTime)
          : new Date();
        const remainingTime = Math.ceil(
          (resetTime.getTime() - Date.now()) / 1000 / 60
        );
        throw new Error(
          `Too many password reset attempts from this location. Please try again in ${remainingTime} minutes.`
        );
      }

      try {
        // Render email using react-email template
        const emailContent = await renderPasswordResetEmail({
          resetUrl: url,
          userEmail: user.email,
        });

        const result = await emailService.sendEmail({
          to: user.email,
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        if (!result.success) {
          console.error("Failed to send password reset email:", result.error);
          throw new Error("Failed to send password reset email");
        }

        console.log("Password reset email sent successfully:", result.message);
      } catch (error) {
        console.error("Error sending password reset email:", error);
        throw error;
      }
    },
    resetPasswordTokenExpiresIn: 3600, // 1 hour in seconds
  },
  database: drizzleAdapter(db, {
    provider: "pg", // PostgreSQL
    schema: authSchema,
  }),
  plugins: [
    // openAPI(),
    admin({
      // Use database-backed roles instead of hardcoded user IDs
      adminRoles: ["super_admin"],
      ac,
      roles: {
        org_admin: roles[Role.ORG_ADMIN],
        super_admin: roles[Role.SUPER_ADMIN],
      },
      // Enable secure impersonation with audit trail
      impersonationSessionDuration: 60 * 60 * 24, // 1 day
    }),
    organization({
      // Disable automatic organization creation - we handle this manually
      allowUserToCreateOrganization: false,
      organizationLimit: parseInt(
        process.env.MAX_ORGANIZATIONS_PER_USER || "5"
      ),
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
    nextCookies(),
  ],
  advanced: {
    generateId: false,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
    updateAge: 60 * 60 * 24,
  },
  // Remove hooks for now to fix the error - we'll implement this differently
  // hooks: {
  //     after: [
  //         // We'll implement post-signup org/project creation in the API layer instead
  //     ],
  // },
});
