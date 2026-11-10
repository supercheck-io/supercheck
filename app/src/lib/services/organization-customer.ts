import { db } from "@/utils/db";
import { organization as orgTable } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { isUuid } from "@/lib/uuid";
import { isPolarEnabled, getPolarConfig } from "@/lib/feature-flags";
import { createPolarClient, type PolarClient } from "@/lib/billing/polar-client";

const ORGANIZATION_EXTERNAL_ID = /^organization:(.+)$/;

/** The owner's email already belongs to a billing customer that cannot be reused safely. */
export class BillingCustomerConflictError extends Error {
  constructor() {
    super("This email already has a Supercheck billing account. Contact support at hello@supercheck.io and we'll link it.");
    this.name = "BillingCustomerConflictError";
  }
}

function statusCodeOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;
}

/**
 * Polar keeps a customer after its organization is deleted, and customer emails are unique, so the
 * owner cannot get a new customer with the same email. Reuse that customer only when it was created
 * for this same user, its organization no longer exists here, no other organization holds it, and it
 * has no active subscription. external_id is immutable, so the new organization is recorded in
 * metadata, which customer events resolve from. The caller has already verified the email.
 * Returns null when no customer has this email (the create failed for another reason). The metadata
 * write is returned, not run: the caller performs it only after the database link succeeds, so a losing
 * concurrent racer never leaves the customer pointing at the wrong organization.
 */
async function reuseDeletedOrganizationCustomer(
  polarClient: PolarClient,
  userId: string,
  userEmail: string,
  organizationId: string,
): Promise<{ id: string; recordMetadata: () => Promise<void> } | null> {
  const { items } = await polarClient.customers.list({ email: userEmail, limit: 2 });
  const matches = items.filter((customer) => customer.email?.toLowerCase() === userEmail.toLowerCase());
  if (matches.length === 0) return null;
  const customer = matches[0];
  const formerOrganizationId = matches.length === 1
    ? ORGANIZATION_EXTERNAL_ID.exec(customer.external_id ?? "")?.[1]
    : undefined;
  // Legacy customers were created with the bare user ID as external_id: the same person by construction.
  const legacy = matches.length === 1 && customer.external_id === userId;
  // The same person, not just the same address: an address can be reassigned to someone else.
  if (!legacy && (!isUuid(formerOrganizationId) || formerOrganizationId === organizationId || customer.metadata?.userId !== userId)) {
    throw new BillingCustomerConflictError();
  }
  const [formerOrganization, holder] = await Promise.all([
    formerOrganizationId && !legacy
      ? db.query.organization.findFirst({ where: eq(orgTable.id, formerOrganizationId), columns: { id: true } })
      : undefined,
    db.query.organization.findFirst({ where: eq(orgTable.polarCustomerId, customer.id), columns: { id: true } }),
  ]);
  if (formerOrganization || holder) throw new BillingCustomerConflictError();
  if ((await polarClient.customers.getState(customer.id)).active_subscriptions.length > 0) {
    throw new BillingCustomerConflictError();
  }
  return {
    id: customer.id,
    recordMetadata: async () => {
      await polarClient.customers.update(customer.id, {
        metadata: { userId, referenceId: organizationId, source: legacy ? "legacy-user-customer" : "supercheck-reused-after-organization-deletion" },
      });
      console.warn(`[Polar] Reused the billing customer of ${legacy ? "a legacy user" : `deleted organization ${formerOrganizationId}`} for ${organizationId}`);
    },
  };
}

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
    let recordReuse: (() => Promise<void>) | undefined;
    try {
      customerId = (await polarClient.customers.getExternal(externalId)).id;
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
            external_id: externalId,
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
        // Resolve this organization's identity; email is consulted only for a rejected create.
        try {
          customerId = (await polarClient.customers.getExternal(externalId)).id;
        } catch (lookupError) {
          if (statusCodeOf(createError) !== 422 || statusCodeOf(lookupError) !== 404) throw createError;
          const reused = await reuseDeletedOrganizationCustomer(polarClient, userId, userEmail, organizationId);
          if (!reused) throw createError;
          customerId = reused.id;
          recordReuse = reused.recordMetadata;
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
    if (linked) {
      await recordReuse?.();
      return linked.polarCustomerId;
    }

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
