"use server";

import { db } from "@/utils/db";
import { statusPages, statusPageSubscribers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { EmailService } from "@/lib/email-service";
import { renderStatusPageVerificationEmail } from "@/lib/email-renderer";
import { generateWebhookSecret } from "@/lib/webhook-utils";

const subscribeSchema = z.union([
  // Email subscription
  z.object({
    statusPageId: z.string().uuid(),
    email: z.string().email("Please enter a valid email address"),
    subscribeToAllComponents: z.boolean().default(true),
    selectedComponentIds: z.array(z.string().uuid()).optional(),
    subscriptionMode: z.literal("email").optional().default("email"),
  }),
  // Webhook subscription
  z.object({
    statusPageId: z.string().uuid(),
    endpoint: z.string().url("Please enter a valid webhook URL"),
    subscriptionMode: z.literal("webhook"),
    description: z.string().max(500).optional(),
    subscribeToAllComponents: z.boolean().default(true),
    selectedComponentIds: z.array(z.string().uuid()).optional(),
  }),
  // Slack subscription
  z.object({
    statusPageId: z.string().uuid(),
    endpoint: z.string().url("Please enter a valid Slack webhook URL"),
    subscriptionMode: z.literal("slack"),
    subscribeToAllComponents: z.boolean().default(true),
    selectedComponentIds: z.array(z.string().uuid()).optional(),
  }),
]);

type SubscribeInput = z.infer<typeof subscribeSchema>;

const generateHexToken = (byteLength = 32) =>
  Array.from(
    crypto.getRandomValues(new Uint8Array(byteLength)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

/**
 * SSRF Protection: Validate webhook URL to prevent Server-Side Request Forgery
 * - Blocks private IP ranges (127.x.x.x, 10.x.x.x, 172.16-31.x.x, 192.168.x.x)
 * - Blocks link-local addresses (169.254.x.x)
 * - Blocks localhost variations
 * - In production, enforces HTTPS
 */
function isUrlSafeForWebhook(urlString: string): { safe: boolean; reason?: string } {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost variations
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".localhost")
    ) {
      return { safe: false, reason: "Localhost URLs are not allowed" };
    }
    
    // Block private IP ranges (only check if it looks like an IP)
    const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Pattern);
    
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      
      // 10.x.x.x (Class A private)
      if (a === 10) {
        return { safe: false, reason: "Private network IPs are not allowed" };
      }
      // 172.16.x.x - 172.31.x.x (Class B private)
      if (a === 172 && b >= 16 && b <= 31) {
        return { safe: false, reason: "Private network IPs are not allowed" };
      }
      // 192.168.x.x (Class C private)
      if (a === 192 && b === 168) {
        return { safe: false, reason: "Private network IPs are not allowed" };
      }
      // 127.x.x.x (Loopback)
      if (a === 127) {
        return { safe: false, reason: "Loopback IPs are not allowed" };
      }
      // 169.254.x.x (Link-local / AWS metadata)
      if (a === 169 && b === 254) {
        return { safe: false, reason: "Link-local addresses are not allowed" };
      }
      // 0.x.x.x (Invalid/broadcast)
      if (a === 0) {
        return { safe: false, reason: "Invalid IP address" };
      }
    }
    
    // In production, require HTTPS for webhooks
    const isProduction = process.env.NODE_ENV === "production";
    if (isProduction && url.protocol !== "https:") {
      return { safe: false, reason: "HTTPS is required for webhook URLs in production" };
    }
    
    return { safe: true };
  } catch {
    return { safe: false, reason: "Invalid URL format" };
  }
}

// Helper function to send verification email
async function sendVerificationEmail(params: {
  email: string;
  statusPageName: string;
  verificationToken: string;
  subdomain: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const emailService = EmailService.getInstance();

    // Construct verification URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const verificationUrl = `${baseUrl}/status/verify/${params.verificationToken}`;

    // Render email using react-email template
    const emailContent = await renderStatusPageVerificationEmail({
      verificationUrl,
      statusPageName: params.statusPageName,
    });

    const result = await emailService.sendEmail({
      to: params.email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });

    if (!result.success) {
      console.error("Failed to send verification email:", result.error);
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending verification email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export async function subscribeToStatusPage(data: SubscribeInput) {
  try {
    // Validate input
    const validatedData = subscribeSchema.parse(data);

    // Check if status page exists and is published
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, validatedData.statusPageId),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found",
      };
    }

    if (statusPage.status !== "published") {
      return {
        success: false,
        message: "This status page is not currently accepting subscriptions",
      };
    }

    // Determine subscription mode and check permissions
    const mode = validatedData.subscriptionMode || "email";

    if (mode === "email" && !statusPage.allowEmailSubscribers) {
      return {
        success: false,
        message: "Email subscriptions are not enabled for this status page",
      };
    }

    if (mode === "webhook" && !statusPage.allowWebhookSubscribers) {
      return {
        success: false,
        message: "Webhook subscriptions are not enabled for this status page",
      };
    }

    if (mode === "slack" && !statusPage.allowSlackSubscribers) {
      return {
        success: false,
        message: "Slack subscriptions are not enabled for this status page",
      };
    }

    // Handle email subscription
    if (mode === "email") {
      const emailData = validatedData as Extract<typeof validatedData, { subscriptionMode?: "email" }>;
      return await handleEmailSubscription(emailData, statusPage);
    }

    // Handle webhook subscription
    if (mode === "webhook") {
      const webhookData = validatedData as Extract<typeof validatedData, { subscriptionMode: "webhook" }>;
      return await handleWebhookSubscription(webhookData, statusPage);
    }

    // Handle Slack subscription
    if (mode === "slack") {
      const slackData = validatedData as Extract<typeof validatedData, { subscriptionMode: "slack" }>;
      return await handleSlackSubscription(slackData, statusPage);
    }

    return {
      success: false,
      message: "Invalid subscription mode",
    };
  } catch (error) {
    console.error("Error subscribing to status page:", error);

    if (error instanceof z.ZodError) {
      return {
        success: false,
        message: error.errors[0]?.message || "Invalid input",
      };
    }

    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
}

// Handle email subscription
async function handleEmailSubscription(
  data: Record<string, unknown>,
  statusPage: Record<string, unknown>
) {
  // Check if email is already subscribed (including unsubscribed with purgeAt)
  const existingSubscriber = await db.query.statusPageSubscribers.findFirst({
    where: (subscribers, { and, eq }) =>
      and(
        eq(subscribers.statusPageId, statusPage.id as string),
        eq(subscribers.email, data.email as string)
      ),
  });

  if (existingSubscriber) {
    // FIX: Allow resubscription if user was previously unsubscribed (purgeAt is set)
    if (existingSubscriber.purgeAt) {
      // Reactivate unsubscribed user - clear purgeAt and issue new tokens
      const newVerificationToken = generateHexToken();
      const newUnsubscribeToken = generateHexToken();

      await db
        .update(statusPageSubscribers)
        .set({
          verificationToken: newVerificationToken,
          unsubscribeToken: newUnsubscribeToken,
          purgeAt: null, // Clear unsubscribe status
          verifiedAt: null, // Require re-verification
          updatedAt: new Date(),
        })
        .where(eq(statusPageSubscribers.id, existingSubscriber.id));

      // Send verification email
      const emailResult = await sendVerificationEmail({
        email: data.email as string,
        statusPageName: (statusPage.headline as string) || (statusPage.name as string),
        verificationToken: newVerificationToken,
        subdomain: statusPage.subdomain as string,
      });

      if (!emailResult.success) {
        console.error("Email sending failed:", emailResult.error);
        return {
          success: false,
          message: "Failed to send verification email. Please try again later or contact support.",
        };
      }

      return {
        success: true,
        message: "Welcome back! Please check your email to verify your subscription.",
        requiresVerification: true,
      };
    }
    
    if (existingSubscriber.verifiedAt) {
      return {
        success: false,
        message: "This email is already subscribed to updates",
      };
    } else {
      // If exists but not verified, update the verification token and resend
      const newVerificationToken = generateHexToken();
      const newUnsubscribeToken = generateHexToken();

      await db
        .update(statusPageSubscribers)
        .set({
          verificationToken: newVerificationToken,
          unsubscribeToken: newUnsubscribeToken,
          updatedAt: new Date(),
        })
        .where(eq(statusPageSubscribers.id, existingSubscriber.id));

      // Send verification email
      const emailResult = await sendVerificationEmail({
        email: data.email as string,
        statusPageName: (statusPage.headline as string) || (statusPage.name as string),
        verificationToken: newVerificationToken,
        subdomain: statusPage.subdomain as string,
      });

      if (!emailResult.success) {
        console.error("Email sending failed:", emailResult.error);
        return {
          success: false,
          message: "Failed to send verification email. Please try again later or contact support.",
        };
      }

      return {
        success: true,
        message:
          "A new verification email has been sent. Please check your inbox.",
        requiresVerification: true,
      };
    }
  }

  // Generate secure tokens
  const verificationToken = generateHexToken();
  const unsubscribeToken = generateHexToken();

  // Create subscriber
  const [subscriber] = await db
    .insert(statusPageSubscribers)
    .values({
      statusPageId: statusPage.id as string,
      email: data.email as string,
      mode: "email",
      verificationToken,
      unsubscribeToken,
      skipConfirmationNotification: false,
      verifiedAt: null, // Will be set after verification
      createdAt: new Date(),
      updatedAt: new Date(),
    })
      .returning();

    // TODO: If specific components selected, create component subscriptions
    // if (!validatedData.subscribeToAllComponents && validatedData.selectedComponentIds) {
    //   await db.insert(statusPageComponentSubscriptions).values(
    //     validatedData.selectedComponentIds.map(componentId => ({
    //       subscriberId: subscriber.id,
    //       componentId,
    //       createdAt: new Date(),
    //     }))
    //   );
    // }

  // Send verification email
  const emailResult = await sendVerificationEmail({
    email: data.email as string,
    statusPageName: (statusPage.headline as string) || (statusPage.name as string),
    verificationToken,
    subdomain: statusPage.subdomain as string,
  });

  if (!emailResult.success) {
    console.error("Email sending failed:", emailResult.error);
    return {
      success: false,
      message: "Failed to send verification email. Please try again later or contact support.",
    };
  }

  // Revalidate the public page
  revalidatePath(`/status/${statusPage.id as string}`);

  return {
    success: true,
    message:
      "Subscription successful! Please check your email to verify your subscription.",
    requiresVerification: true,
    subscriberId: subscriber.id,
  };
}

// Handle webhook subscription
async function handleWebhookSubscription(
  data: Record<string, unknown>,
  statusPage: Record<string, unknown>
) {
  try {
    const endpoint = data.endpoint as string;

    // SECURITY: Validate webhook URL for SSRF protection
    const ssrfCheck = isUrlSafeForWebhook(endpoint);
    if (!ssrfCheck.safe) {
      return {
        success: false,
        message: ssrfCheck.reason || "Invalid webhook URL",
      };
    }

    // Check if webhook already exists
    const existingSubscriber = await db.query.statusPageSubscribers.findFirst({
      where: (subscribers, { and, eq }) =>
        and(
          eq(subscribers.statusPageId, statusPage.id as string),
          eq(subscribers.endpoint, data.endpoint as string)
        ),
    });

    if (existingSubscriber && existingSubscriber.verifiedAt) {
      return {
        success: false,
        message: "This webhook endpoint is already subscribed to updates",
      };
    }

    // Delete old unverified webhook if exists
    if (existingSubscriber && !existingSubscriber.verifiedAt) {
      await db
        .update(statusPageSubscribers)
        .set({
          unsubscribeToken: generateHexToken(),
          updatedAt: new Date(),
        })
        .where(eq(statusPageSubscribers.id, existingSubscriber.id));

      return {
        success: true,
        message: "Webhook subscription updated successfully",
        subscriberId: existingSubscriber.id,
      };
    }

    // Generate secure tokens
    const unsubscribeToken = generateHexToken();
    const webhookSecret = generateWebhookSecret();

    // Create webhook subscriber (immediately verified - no email verification needed)
    const [subscriber] = await db
      .insert(statusPageSubscribers)
      .values({
        statusPageId: statusPage.id as string,
        endpoint: data.endpoint as string,
        mode: "webhook",
        unsubscribeToken,
        webhookSecret, // Persist the webhook secret for HMAC verification
        skipConfirmationNotification: false,
        verifiedAt: new Date(), // Webhooks are immediately verified
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // TODO: If specific components selected, create component subscriptions
    // if (!data.subscribeToAllComponents && data.selectedComponentIds) {
    //   await db.insert(statusPageComponentSubscriptions).values(
    //     data.selectedComponentIds.map(componentId => ({
    //       subscriberId: subscriber.id,
    //       componentId,
    //       createdAt: new Date(),
    //     }))
    //   );
    // }

    // Revalidate the public page
    revalidatePath(`/status/${statusPage.id as string}`);

    return {
      success: true,
      message: "Webhook subscription successful! Your endpoint will receive incident notifications.",
      subscriberId: subscriber.id,
      webhookSecret, // Return secret for documentation purposes
    };
  } catch (error) {
    console.error("Error creating webhook subscription:", error);
    return {
      success: false,
      message: "Failed to create webhook subscription. Please try again later.",
    };
  }
}

// Handle Slack subscription
async function handleSlackSubscription(
  data: Record<string, unknown>,
  statusPage: Record<string, unknown>
) {
  try {
    const endpoint = data.endpoint as string;

    // Validate that endpoint is a Slack webhook URL
    try {
      const url = new URL(endpoint);
      if (!url.hostname.endsWith(".slack.com")) {
        return {
          success: false,
          message: "Invalid Slack webhook URL. Must be from a slack.com domain (e.g., hooks.slack.com).",
        };
      }
    } catch {
      return {
        success: false,
        message: "Invalid webhook URL format",
      };
    }

    // Check if Slack webhook already exists
    const existingSubscriber = await db.query.statusPageSubscribers.findFirst({
      where: (subscribers, { and, eq }) =>
        and(
          eq(subscribers.statusPageId, statusPage.id as string),
          eq(subscribers.endpoint, endpoint),
          eq(subscribers.mode, "slack")
        ),
    });

    if (existingSubscriber && existingSubscriber.verifiedAt) {
      return {
        success: false,
        message: "This Slack webhook is already subscribed to updates",
      };
    }

    // Delete old unverified Slack subscription if exists
    if (existingSubscriber && !existingSubscriber.verifiedAt) {
      await db
        .update(statusPageSubscribers)
        .set({
          unsubscribeToken: generateHexToken(),
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(statusPageSubscribers.id, existingSubscriber.id));

      return {
        success: true,
        message: "Slack subscription updated successfully",
        subscriberId: existingSubscriber.id,
      };
    }

    // Generate secure tokens
    const unsubscribeToken = generateHexToken();

    // Create Slack subscriber (immediately verified - no email verification needed)
    const [subscriber] = await db
      .insert(statusPageSubscribers)
      .values({
        statusPageId: statusPage.id as string,
        endpoint,
        mode: "slack",
        unsubscribeToken,
        skipConfirmationNotification: false,
        verifiedAt: new Date(), // Slack subscriptions are immediately verified
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // TODO: If specific components selected, create component subscriptions
    // if (!data.subscribeToAllComponents && data.selectedComponentIds) {
    //   await db.insert(statusPageComponentSubscriptions).values(
    //     data.selectedComponentIds.map(componentId => ({
    //       subscriberId: subscriber.id,
    //       componentId,
    //       createdAt: new Date(),
    //     }))
    //   );
    // }

    // Revalidate the public page
    revalidatePath(`/status/${statusPage.id as string}`);

    return {
      success: true,
      message: "Slack subscription successful! Your channel will now receive incident notifications.",
      subscriberId: subscriber.id,
    };
  } catch (error) {
    console.error("Error creating Slack subscription:", error);
    return {
      success: false,
      message: "Failed to create Slack subscription. Please try again later.",
    };
  }
}
