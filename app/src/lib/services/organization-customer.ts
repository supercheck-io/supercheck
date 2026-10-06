import { db } from "@/utils/db";
import { organization as orgTable } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import { createPolarClient } from "@/lib/billing/polar-client";

/**
 * Provision one Polar customer per organization. Preserve existing customer IDs:
 * legacy bindings may have paid subscriptions and require explicit migration.
 */
export async function ensurePolarCustomerAndLink(
  userId: string,
  userEmail: string,
  userName: string | null,
  organizationId: string,
  options: { throwOnError?: boolean } = {},
): Promise<string | null> {
  if (!isPolarEnabled()) return null;
  const config = getPolarConfig();
  if (!config) return null;

  try {
    const org = await db.query.organization.findFirst({
      where: eq(orgTable.id, organizationId),
      columns: { polarCustomerId: true },
    });
    if (!org) return null;
    if (org.polarCustomerId) return org.polarCustomerId;

    const polarClient = createPolarClient({
      accessToken: config.accessToken,
      server: config.server,
    });
    // A person may own several organizations. User ID/email are not billing
    // tenant identifiers and must never select another organization's customer.
    const externalId = `organization:${organizationId}`;
    let customerId: string;
    try {
      customerId = (await polarClient.customers.getExternal({ externalId })).id;
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          error.statusCode === 404
        )
      ) {
        throw error;
      }
      try {
        customerId = (
          await polarClient.customers.create({
            externalId,
            email: userEmail,
            name: userName || userEmail,
            metadata: {
              userId,
              referenceId: organizationId,
              source: "supercheck-setup-defaults",
            },
          })
        ).id;
      } catch (createError) {
        // A concurrent setup may have created the same external ID first.
        // Resolve only this organization's identity; never fall back to email.
        try {
          customerId = (await polarClient.customers.getExternal({ externalId }))
            .id;
        } catch {
          throw createError;
        }
      }
    }

    const [linked] = await db
      .update(orgTable)
      .set({ polarCustomerId: customerId })
      .where(
        and(eq(orgTable.id, organizationId), isNull(orgTable.polarCustomerId)),
      )
      .returning({ polarCustomerId: orgTable.polarCustomerId });
    if (linked) return linked.polarCustomerId;

    const current = await db.query.organization.findFirst({
      where: eq(orgTable.id, organizationId),
      columns: { polarCustomerId: true },
    });
    return current?.polarCustomerId ?? null;
  } catch (error) {
    console.error(
      "[Polar] Customer setup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    if (options.throwOnError) throw error;
    return null;
  }
}
