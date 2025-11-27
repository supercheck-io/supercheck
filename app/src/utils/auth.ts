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
import { isPolarEnabled, getPolarConfig, getPolarProducts } from "@/lib/feature-flags";

/**
 * Get Polar plugin configuration if enabled
 * Returns null if Polar is disabled or not configured
 */
function getPolarPlugin() {
  if (!isPolarEnabled()) {
    return null;
  }

  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { polar, checkout, portal, usage, webhooks } = require("@polar-sh/better-auth");
    const { Polar } = require("@polar-sh/sdk");
    /* eslint-enable @typescript-eslint/no-require-imports */

    const config = getPolarConfig()!;
    const products = getPolarProducts();

    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });

    // Polar client initialized successfully

    return polar({
      client: polarClient,
      // Enable automatic customer creation on signup
      // This ensures the user's email is pre-filled in checkout
      createCustomerOnSignUp: true,
      // Provide customer metadata - user object should have id after DB insert
      getCustomerCreateParams: async ({ user }: { user: { id?: string; email?: string; name?: string } }) => {
        // Log for debugging
        console.log('[Polar] Creating customer for user:', { id: user.id, email: user.email, name: user.name });
        
        return {
          email: user.email || '',
          name: user.name || user.email || '',
          metadata: {
            // Only include userId if it exists
            ...(user.id ? { userId: String(user.id) } : {}),
            source: 'supercheck-signup',
          },
        };
      },
      use: [
        checkout({
          products: products
            ? [
                {
                  productId: products.plusProductId,
                  slug: "plus",
                },
                {
                  productId: products.proProductId,
                  slug: "pro",
                },
              ]
            : [],
          // Use absolute URL to ensure correct redirect after checkout
          successUrl: `${process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || 'http://localhost:3000'}/billing/success?checkout_id={CHECKOUT_ID}`,
          authenticatedUsersOnly: true,
        }),
        portal({
          returnUrl:
            process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL,
        }),
        usage(),
        webhooks({
          secret: config.webhookSecret!,
          // Catch-all handler to log all events and handle subscription updates
          onPayload: async (payload: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
            // Import handlers dynamically inside the callback
            const {
              handleSubscriptionActive,
              handleSubscriptionUpdated,
              handleSubscriptionCanceled,
              handleOrderPaid,
            } = await import("@/lib/webhooks/polar-webhooks");

            // Handle subscription events - only log event type for debugging
            console.log('[Polar] Webhook:', payload.type);

            // Handle subscription events
            if (payload.type === 'subscription.active' || payload.type === 'subscription.created') {
              await handleSubscriptionActive(payload);
            } else if (payload.type === 'subscription.updated') {
              await handleSubscriptionUpdated(payload);
            } else if (payload.type === 'subscription.canceled') {
              await handleSubscriptionCanceled(payload);
            } else if (payload.type === 'order.paid' || payload.type === 'order.created' || payload.type === 'order.updated' || payload.type === 'checkout.created' || payload.type === 'checkout.updated') {
              // Handle order and checkout events - these may also activate subscriptions
              await handleOrderPaid(payload);
            } else if (payload.type === 'customer.created' || payload.type === 'customer.updated' || payload.type === 'customer.state_changed') {
              // Customer events are informational - no action needed
            } else {
              // Log any unhandled event types for debugging
              console.log('[Polar] Unhandled webhook:', payload.type);
            }
          },
        }),
      ],
    });
  } catch (error) {
    console.error("[Better Auth] Failed to initialize Polar plugin:", error);
    return null;
  }
}

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
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      enabled: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      enabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      // Get refresh token on first login and prompt for account selection
      accessType: "offline",
      prompt: "select_account consent",
    },
  },
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
    // Conditionally add Polar plugin if enabled
    ...(getPolarPlugin() ? [getPolarPlugin()!] : []),
  ],
  advanced: {
    database: {
      generateId: false,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days in seconds
    updateAge: 60 * 60 * 24,
  },
  // Note: Organization and project creation for social auth signups
  // is handled client-side by checking for new users and calling
  // /api/auth/setup-defaults from the sign-in/sign-up pages.
  // Polar customer creation is handled automatically by the Polar plugin
  // via createCustomerOnSignUp: true
});
