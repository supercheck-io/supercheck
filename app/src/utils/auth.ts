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
        const result = await emailService.sendEmail({
          to: user.email,
          subject: "Reset your Supercheck password",
          text: `You requested a password reset for your Supercheck account. Click the link below to reset your password:\n\n${url}\n\nThis link will expire in 1 hour for security reasons.\n\nIf you didn't request this reset, please ignore this email.`,
          html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #333;">Reset your Supercheck password</h2>
                            <p>You requested a password reset for your Supercheck account.</p>
                            <p>Click the button below to reset your password:</p>
                            <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 4px; margin: 16px 0;">Reset Password</a>
                            <p style="color: #666; font-size: 14px;">This link will expire in 1 hour for security reasons.</p>
                            <p style="color: #666; font-size: 14px;">If you didn't request this reset, please ignore this email.</p>
                            <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;">
                            <p style="color: #999; font-size: 12px;">Supercheck - Automation & Monitoring Platform</p>
                        </div>
                    `,
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
