import { notificationProviders } from "@/db/schema";
import { db } from "@/utils/db";
import { and, eq, inArray } from "drizzle-orm";

type ValidateNotificationProviderOwnershipOptions = {
  providerIds: string[];
  organizationId: string;
  projectId: string;
};

export async function validateNotificationProviderOwnership(
  options: ValidateNotificationProviderOwnershipOptions
): Promise<string[]> {
  const validatedProviderIds = [...new Set(options.providerIds)];

  if (validatedProviderIds.length === 0) {
    return [];
  }

  const providers = await db
    .select({ id: notificationProviders.id })
    .from(notificationProviders)
    .where(
      and(
        inArray(notificationProviders.id, validatedProviderIds),
        eq(notificationProviders.organizationId, options.organizationId),
        eq(notificationProviders.projectId, options.projectId)
      )
    );

  const providerIdSet = new Set(providers.map((provider) => provider.id));
  const hasInvalidProviders = validatedProviderIds.some(
    (providerId) => !providerIdSet.has(providerId)
  );

  if (hasInvalidProviders) {
    throw new Error("Invalid or unauthorized notification provider IDs");
  }

  return validatedProviderIds;
}
