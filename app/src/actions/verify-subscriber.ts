"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

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
      return {
        success: true,
        alreadyVerified: true,
        message: "Your subscription has already been verified",
        statusPageId: subscriber.statusPageId,
      };
    }

    // Check if token is expired (24 hours)
    const createdAt = new Date(subscriber.createdAt || Date.now());
    const now = new Date();
    const hoursSinceCreation =
      (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);

    if (hoursSinceCreation > 24) {
      return {
        success: false,
        message: "Verification link has expired. Please subscribe again.",
      };
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
    };
  } catch (error) {
    console.error("Error verifying subscriber:", error);
    return {
      success: false,
      message: "An error occurred during verification. Please try again.",
    };
  }
}
