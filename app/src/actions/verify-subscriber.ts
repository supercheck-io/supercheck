"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers, statusPages } from "@/db/schema";
import { eq, and, isNull, isNotNull, count } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { checkSubscriberLimit } from "@/lib/middleware/plan-enforcement";

export async function verifySubscriber(token: string) {
  try {
    if (!token || token.length !== 64) {
      return {
        success: false,
        message: "Invalid verification token",
      };
    }

    // Find subscriber with this verification token
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.verificationToken, token),
    });

    if (!subscriber) {
      return {
        success: false,
        message: "Invalid or expired verification link",
      };
    }

    // Check if already verified
    if (subscriber.verifiedAt) {
      // Pre-fetch language for already-verified case
      const sp = await db.query.statusPages.findFirst({
        where: eq(statusPages.id, subscriber.statusPageId),
        columns: { language: true },
      });
      return {
        success: true,
        alreadyVerified: true,
        message: "Your subscription has already been verified",
        statusPageId: subscriber.statusPageId,
        language: sp?.language ?? "en",
      };
    }

    // FIX: Check if token is expired (24 hours from token generation)
    // Use updatedAt if available (token was regenerated via resend), otherwise createdAt
    const tokenGeneratedAt = subscriber.updatedAt
      ? new Date(subscriber.updatedAt)
      : new Date(subscriber.createdAt || Date.now());
    const now = new Date();
    const hoursSinceTokenGeneration =
      (now.getTime() - tokenGeneratedAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceTokenGeneration > 24) {
      return {
        success: false,
        message: "Verification link has expired. Please subscribe again.",
      };
    }

    // Enforce subscriber limits at activation time (verified subscribers only)
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, subscriber.statusPageId),
      columns: {
        organizationId: true,
        language: true,
      },
    });

    if (statusPage?.organizationId) {
      const [subscriberCountResult] = await db
        .select({ value: count() })
        .from(statusPageSubscribers)
        .where(
          and(
            eq(statusPageSubscribers.statusPageId, subscriber.statusPageId),
            isNull(statusPageSubscribers.purgeAt),
            isNotNull(statusPageSubscribers.verifiedAt)
          )
        );

      const currentSubscriberCount = subscriberCountResult?.value ?? 0;

      const limitCheck = await checkSubscriberLimit(
        statusPage.organizationId,
        currentSubscriberCount
      );

      if (!limitCheck.allowed) {
        return {
          success: false,
          message:
            limitCheck.error ||
            "Subscriber limit reached for this status page.",
        };
      }
    }

    // Verify the subscriber
    await db
      .update(statusPageSubscribers)
      .set({
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(statusPageSubscribers.id, subscriber.id));

    // Revalidate both public and internal paths
    revalidatePath(`/status/${subscriber.statusPageId}`);
    revalidatePath(`/status-pages/${subscriber.statusPageId}/public`);

    return {
      success: true,
      message: "Your subscription has been verified successfully!",
      statusPageId: subscriber.statusPageId,
      language: statusPage?.language ?? "en",
    };
  } catch (error) {
    console.error("Error verifying subscriber:", error);
    return {
      success: false,
      message: "An error occurred during verification. Please try again.",
    };
  }
}
