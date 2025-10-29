"use server";

import { db } from "@/utils/db";
import { statusPages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireProjectContext } from "@/lib/project-context";
import { generateProxyUrl } from "@/lib/asset-proxy";

export async function getStatusPage(id: string) {
  try {
    // Get current project context (includes auth verification)
    await requireProjectContext();

    // Get the status page
    const statusPage = await db.query.statusPages.findFirst({
      where: eq(statusPages.id, id),
    });

    if (!statusPage) {
      return {
        success: false,
        message: "Status page not found",
      };
    }

    // Generate proxy URLs for logo assets
    // This converts S3 keys stored in the database to proxy URLs
    const faviconUrl = generateProxyUrl(statusPage.faviconLogo);
    const logoUrl = generateProxyUrl(statusPage.transactionalLogo);
    const coverUrl = generateProxyUrl(statusPage.heroCover);

    return {
      success: true,
      statusPage: {
        ...statusPage,
        faviconLogo: faviconUrl,
        transactionalLogo: logoUrl,
        heroCover: coverUrl,
      },
    };
  } catch (error) {
    console.error("Error fetching status page:", error);
    return {
      success: false,
      message: "Failed to fetch status page",
      error,
    };
  }
}
