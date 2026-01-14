import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/utils/db";
import { authSchema } from "@/db/schema";
import { apiKey, organization, admin, lastLoginMethod, captcha } from "better-auth/plugins";
import { ac, roles, Role } from "@/lib/rbac/permissions";
import { EmailService } from "@/lib/email-service";
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
import {
  isPolarEnabled,
  getPolarConfig,
  getPolarProducts,
  isCloudHosted,
  isCaptchaEnabled,
} from "@/lib/feature-flags";

/**
 * Get Polar plugin configuration if enabled
 * Returns null if Polar is disabled or not configured
 */
function getPolarPlugin() {
  if (!isPolarEnabled()) {
    return null;
  }

  try {
     
    const {
      polar,
      checkout,
      portal,
      usage,
      webhooks,
    } = require("@polar-sh/better-auth");
    const { Polar } = require("@polar-sh/sdk");
     

    const config = getPolarConfig()!;
    const products = getPolarProducts();

    const polarClient = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });

    // Polar client initialized successfully

    return polar({
      client: polarClient,
      // IMPORTANT: Disable automatic customer creation on signup
      // This is intentionally disabled because:
      // 1. If Polar customer creation fails during signup (e.g., external_id conflict),
      //    the entire signup process would fail and throw an error to the user
      // 2. Instead, customer creation is handled by /api/auth/setup-defaults after signup
      //    which has proper error handling (ensurePolarCustomerAndLink function)
      // 3. This ensures signup always succeeds, and Polar customer is created gracefully
      createCustomerOnSignUp: false,
      // Note: getCustomerCreateParams is kept for reference but won't be called
      // since createCustomerOnSignUp is false
      getCustomerCreateParams: async ({
        user,
      }: {
        user: { id?: string; email?: string; name?: string };
      }) => {
        console.log("[Polar] Creating customer for user:", {
          id: user.id,
          email: user.email,
          name: user.name,
        });

        // Only return metadata - the plugin handles email/name from user object
        // Social auth users get their data synced via syncPolarCustomerData() in setup-defaults
        return {
          metadata: {
            ...(user.id ? { userId: String(user.id) } : {}),
            source: "supercheck-signup",
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
          successUrl: `${process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000"}/billing/success?checkout_id={CHECKOUT_ID}`,
          authenticatedUsersOnly: true,
        }),
        portal({
          returnUrl:
            process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL,
        }),
        usage(),
        webhooks({
          secret: config.webhookSecret!,
          // Customer lifecycle handlers - critical for linking customer to organization
           
          onCustomerCreated: async (payload: any) => {
            console.log("[Polar] Webhook: customer.created");
            const { handleCustomerCreated } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleCustomerCreated(payload);
          },
          // Subscription lifecycle handlers
           
          onSubscriptionActive: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.active");
            const { handleSubscriptionActive } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionActive(payload);
          },
           
          onSubscriptionCreated: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.created");
            const { handleSubscriptionActive } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionActive(payload);
          },
           
          onSubscriptionUpdated: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.updated");
            const { handleSubscriptionUpdated } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionUpdated(payload);
          },
           
          onSubscriptionCanceled: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.canceled");
            const { handleSubscriptionCanceled } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionCanceled(payload);
          },
          // Handle subscription uncancellation - user reverses cancellation during grace period
           
          onSubscriptionUncanceled: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.uncanceled");
            const { handleSubscriptionUncanceled } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionUncanceled(payload);
          },
          // CRITICAL: Handle subscription revocation - immediate access termination
           
          onSubscriptionRevoked: async (payload: any) => {
            console.log("[Polar] Webhook: subscription.revoked");
            const { handleSubscriptionRevoked } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleSubscriptionRevoked(payload);
          },
          // Order creation handler - activates subscription when payment is initiated
          // Polar sends order.created when checkout completes successfully
           
          onOrderCreated: async (payload: any) => {
            console.log("[Polar] Webhook: order.created - activating subscription");
            const { handleOrderPaid } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            // Use the same handler as order.paid since order.created means payment was successful
            await handleOrderPaid(payload);
          },
          // Payment confirmation handler
           
          onOrderPaid: async (payload: any) => {
            console.log("[Polar] Webhook: order.paid");
            const { handleOrderPaid } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleOrderPaid(payload);
          },
          // Customer state change - useful for syncing customer data
          onCustomerStateChanged: async () => {
            console.log("[Polar] Webhook: customer.state_changed");
            const { handleCustomerStateChanged } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleCustomerStateChanged();
          },
          // CRITICAL: Handle customer deletion - revoke access immediately
           
          onCustomerDeleted: async (payload: any) => {
            console.log("[Polar] Webhook: customer.deleted");
            const { handleCustomerDeleted } = await import(
              "@/lib/webhooks/polar-webhooks"
            );
            await handleCustomerDeleted(payload);
          },
          // Catch-all for logging and handling any other events
           
          onPayload: async (payload: any) => {
            // Log all events for debugging/monitoring
            console.log("[Polar] Webhook received:", payload.type);
          },
        }),
      ],
    });
  } catch (error) {
    console.error("[Better Auth] Failed to initialize Polar plugin:", error);
    return null;
  }
}

/**
 * Get CAPTCHA plugin configuration if enabled
 *
 * CAPTCHA protection is automatically enabled when TURNSTILE_SECRET_KEY is set.
 * Uses Cloudflare Turnstile in invisible mode for seamless user experience.
 *
 * Protected endpoints:
 * - /sign-in/email - Email/password sign in
 * - /sign-up/email - Email/password registration
 * - /forget-password - Password reset requests
 */
function getCaptchaPlugin() {
  if (!isCaptchaEnabled()) {
    return null;
  }

  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return null;
  }

  console.log("[Better Auth] CAPTCHA protection enabled (Cloudflare Turnstile)");

  return captcha({
    provider: "cloudflare-turnstile",
    secretKey,
    // Protect authentication endpoints from bot attacks
    endpoints: ["/sign-up/email", "/sign-in/email", "/forget-password"],
  });
}

export const auth = betterAuth({
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
            origins.push(`https://*.${statusDomain.replace(/^https?:\/\//, "")}`);
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
  // Email verification - only required in cloud mode
  emailVerification: isCloudHosted()
    ? {
        sendVerificationEmail: async ({ user, url }, request) => {
          // Rate limit by email address to prevent abuse
          const emailRateLimit = await checkEmailVerificationRateLimit(user.email);
          if (!emailRateLimit.allowed) {
            const resetTime = emailRateLimit.resetTime
              ? new Date(emailRateLimit.resetTime)
              : new Date();
            const remainingTime = Math.ceil(
              (resetTime.getTime() - Date.now()) / 1000 / 60
            );
            throw new Error(
              `Too many verification email requests. Please try again in ${remainingTime} minutes.`
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
              (resetTime.getTime() - Date.now()) / 1000 / 60
            );
            throw new Error(
              `Too many verification email requests from this location. Please try again in ${remainingTime} minutes.`
            );
          }

          const emailService = EmailService.getInstance();

          // Modify the verification URL to redirect to sign-in with verified flag
          const verificationUrl = new URL(url);
          // The callback URL after verification should be sign-in with verified flag
          verificationUrl.searchParams.set(
            "callbackURL",
            "/sign-in?verified=true"
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
      }
    : undefined,
  emailAndPassword: {
    enabled: true,
    // Only require email verification in cloud mode
    requireEmailVerification: isCloudHosted(),
    sendResetPassword: async ({ user, url }, request) => {
      const emailService = EmailService.getInstance();

      // Extract IP from request for rate limiting
      const clientIP = request ? getClientIP(request.headers) : "unknown";

      // Rate limit by email address
      const emailRateLimit = await checkPasswordResetRateLimit(user.email);
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
      const ipRateLimit = await checkPasswordResetRateLimit(clientIP);
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
    // Track last login method for better UX (shows "Last used" badge)
    lastLoginMethod(),
    // Conditionally add Polar plugin if enabled
    ...(getPolarPlugin() ? [getPolarPlugin()!] : []),
    // Conditionally add CAPTCHA plugin if enabled (Cloudflare Turnstile)
    ...(getCaptchaPlugin() ? [getCaptchaPlugin()!] : []),
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
  // Polar customer creation is handled by /api/auth/setup-defaults
  // (NOT by the Polar plugin - createCustomerOnSignUp is disabled to prevent errors)
});
