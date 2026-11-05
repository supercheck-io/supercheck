"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { isUnsubscribeTokenShape, unsubscribeTokenCondition } from "@/lib/subscriber-tokens";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createHash } from "node:crypto";
import { getClientIP } from "@/lib/session-security";
import { apiKeyRateLimiter } from "@/lib/api-key-rate-limiter";

const UNSUBSCRIBE_WINDOW_SECONDS = 600;
// One-click POSTs arrive from shared mailbox-provider egress IPs, so leave room for a large send.
const UNSUBSCRIBE_MAX_PER_IP = 120;
const UNSUBSCRIBE_LIMIT_DEADLINE_MS = 2000;

/**
 * Per-IP cap on token lookups. Fails open on any limiter failure or a slow Redis:
 * a recipient must always be able to unsubscribe.
 */
async function withinUnsubscribeLimit(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ip = getClientIP(await headers());
    // No trustworthy IP: a shared bucket would let one caller block everyone, so skip the
    // per-IP cap (as sign-in lockout does). Forged tokens fail the signature check without a lookup.
    if (ip === "unknown") return true;
    const client = createHash("sha256").update(ip).digest("hex");
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), UNSUBSCRIBE_LIMIT_DEADLINE_MS);
    });
    const limit = await Promise.race([
      apiKeyRateLimiter.checkAndIncrement(`status-unsubscribe:${client}`, {
        enabled: true,
        timeWindow: UNSUBSCRIBE_WINDOW_SECONDS,
        maxRequests: UNSUBSCRIBE_MAX_PER_IP,
      }),
      deadline,
    ]);
    if (!limit) {
      console.error("Unsubscribe rate limit check timed out; allowing request.");
      return true;
    }
    return limit.allowed || limit.unavailable === true;
  } catch (error) {
    console.error("Unsubscribe rate limit check failed; allowing request:", error);
    return true;
  } finally {
    clearTimeout(timer);
  }
}

const RATE_LIMITED = {
  success: false,
  rateLimited: true,
  retryAfter: UNSUBSCRIBE_WINDOW_SECONDS,
  message: "Too many requests. Please try again in a few minutes.",
} as const;

export async function unsubscribeFromStatusPage(token: string) {
  try {
    if (!(await withinUnsubscribeLimit())) return RATE_LIMITED;
    const where = isUnsubscribeTokenShape(token) ? unsubscribeTokenCondition(token) : null;
    if (!where) {
      return {
        success: false,
        message: "Invalid unsubscribe token",
      };
    }

    // Find subscriber with this unsubscribe token
    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where,
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
    if (!(await withinUnsubscribeLimit())) {
      return { success: false, subscriber: null, rateLimited: true, retryAfter: UNSUBSCRIBE_WINDOW_SECONDS };
    }
    const where = unsubscribeTokenCondition(token);
    if (!where) {
      return { success: false, subscriber: null };
    }

    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where,
      // SECURITY: explicit allow-list; never return tokens or webhook secrets.
      columns: {
        id: true,
        email: true,
        statusPageId: true,
        purgeAt: true,
      },
      with: {
        statusPage: { columns: { name: true, language: true } },
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
