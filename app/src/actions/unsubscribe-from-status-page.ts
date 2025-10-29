"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function unsubscribeFromStatusPage(token: string) {
  try {
    if (!token || token.length !== 64) {
      return {
        success: false,
        message: "Invalid unsubscribe token",
      };
    }

    // Find subscriber with this unsubscribe token
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.unsubscribeToken, token),
    });

    if (!subscriber) {
      return {
        success: false,
        message: "Invalid unsubscribe link",
      };
    }

    // Check if already unsubscribed (purge date set)
    if (subscriber.purgeAt) {
      return {
        success: true,
        alreadyUnsubscribed: true,
        message: "You have already unsubscribed",
        statusPageId: subscriber.statusPageId,
      };
    }

    // Set purge date to 30 days from now (soft delete)
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() + 30);

    await db
      .update(statusPageSubscribers)
      .set({
        purgeAt: purgeDate,
        updatedAt: new Date(),
      })
      .where(eq(statusPageSubscribers.id, subscriber.id));

    // Revalidate both public and internal paths
    revalidatePath(`/status/${subscriber.statusPageId}`);
    revalidatePath(`/status-pages/${subscriber.statusPageId}/public`);

    return {
      success: true,
      message: "You have been successfully unsubscribed",
      statusPageId: subscriber.statusPageId,
      email: subscriber.email,
    };
  } catch (error) {
    console.error("Error unsubscribing:", error);
    return {
      success: false,
      message: "An error occurred while unsubscribing. Please try again.",
    };
  }
}

export async function getSubscriberByToken(token: string) {
  try {
    if (!token || token.length !== 64) {
      return { success: false, subscriber: null };
    }

    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.unsubscribeToken, token),
      with: {
        statusPage: true,
      },
    });

    if (!subscriber) {
      return { success: false, subscriber: null };
    }

    return { success: true, subscriber };
  } catch (error) {
    console.error("Error fetching subscriber:", error);
    return { success: false, subscriber: null };
  }
}
