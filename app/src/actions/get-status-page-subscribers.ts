"use server";

import { db } from "@/utils/db";
import { statusPageSubscribers } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { EmailService } from "@/lib/email-service";
import { renderStatusPageVerificationEmail } from "@/lib/email-renderer";

export async function getStatusPageSubscribers(statusPageId: string) {
  try {
    await requireProjectContext();

    const subscribers = await db.query.statusPageSubscribers.findMany({
      where: and(
        eq(statusPageSubscribers.statusPageId, statusPageId),
        isNull(statusPageSubscribers.purgeAt) // Only show active subscribers
      ),
      orderBy: (subscribers, { desc }) => [desc(subscribers.createdAt)],
    });

    // Calculate stats
    const verifiedCount = subscribers.filter((s) => s.verifiedAt).length;
    const pendingCount = subscribers.filter((s) => !s.verifiedAt).length;

    return {
      success: true,
      subscribers,
      stats: {
        total: subscribers.length,
        verified: verifiedCount,
        pending: pendingCount,
      },
    };
  } catch (error) {
    console.error("Error fetching subscribers:", error);
    return {
      success: false,
      message: "Failed to fetch subscribers",
      subscribers: [],
      stats: { total: 0, verified: 0, pending: 0 },
    };
  }
}

export async function deleteSubscriber(subscriberId: string) {
  try {
    await requireProjectContext();

    // Soft delete by setting purge date
    const purgeDate = new Date();
    purgeDate.setDate(purgeDate.getDate() + 30);

    await db
      .update(statusPageSubscribers)
      .set({
        purgeAt: purgeDate,
        updatedAt: new Date(),
      })
      .where(eq(statusPageSubscribers.id, subscriberId));

    return {
      success: true,
      message: "Subscriber removed successfully",
    };
  } catch (error) {
    console.error("Error deleting subscriber:", error);
    return {
      success: false,
      message: "Failed to remove subscriber",
    };
  }
}

export async function resendVerificationEmail(subscriberId: string) {
  try {
    await requireProjectContext();

    const subscriber = await db.query.statusPageSubscribers.findFirst({
      where: eq(statusPageSubscribers.id, subscriberId),
    });

    if (!subscriber) {
      return {
        success: false,
        message: "Subscriber not found",
      };
    }

    if (subscriber.verifiedAt) {
      return {
        success: false,
        message: "Subscriber is already verified",
      };
    }

    // Check rate limiting (5 minutes)
    const updatedAt = subscriber.updatedAt ? new Date(subscriber.updatedAt) : new Date(subscriber.createdAt || Date.now());
    const now = new Date();
    const minutesSinceUpdate = (now.getTime() - updatedAt.getTime()) / (1000 * 60);

    if (minutesSinceUpdate < 5) {
      return {
        success: false,
        message: `Please wait ${Math.ceil(5 - minutesSinceUpdate)} minutes before resending`,
      };
    }

    // Generate new verification token
    const { randomBytes } = await import("crypto");
    const newVerificationToken = randomBytes(32).toString("hex");

    await db
      .update(statusPageSubscribers)
      .set({
        verificationToken: newVerificationToken,
        updatedAt: new Date(),
      })
      .where(eq(statusPageSubscribers.id, subscriberId));

    // Send verification email
    try {
      const emailService = EmailService.getInstance();

      // Get status page details
      const statusPage = await db.query.statusPages.findFirst({
        where: (pages, { eq }) => eq(pages.id, subscriber.statusPageId),
      });

      if (statusPage) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const verificationUrl = `${baseUrl}/status-pages/verify/${newVerificationToken}`;

        // Render email using react-email template
        const emailContent = await renderStatusPageVerificationEmail({
          verificationUrl,
          statusPageName: statusPage.headline || statusPage.name,
        });

        const result = await emailService.sendEmail({
          to: subscriber.email || "",
          subject: emailContent.subject,
          text: emailContent.text,
          html: emailContent.html,
        });

        if (!result.success) {
          console.error("Failed to send verification email:", result.error);
        }
      }
    } catch (emailError) {
      console.error("Error sending verification email:", emailError);
    }

    return {
      success: true,
      message: "Verification email sent successfully",
    };
  } catch (error) {
    console.error("Error resending verification email:", error);
    return {
      success: false,
      message: "Failed to resend verification email",
    };
  }
}
