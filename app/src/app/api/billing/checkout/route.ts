import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { organization } from "@/db/schema";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import {
  getPolarConfig,
  getPolarProducts,
  isPolarEnabled,
} from "@/lib/feature-flags";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { db } from "@/utils/db";
import { eq } from "drizzle-orm";

const checkoutSchema = z.object({
  plan: z.enum(["plus", "pro"]),
});

function getAppUrl(request: NextRequest) {
  const configured = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
  const url = new URL(configured || request.nextUrl.origin);

  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("Production billing requires an HTTPS application URL");
  }

  return url.origin;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json(
        { error: "Billing checkout requires an interactive browser session" },
        { status: 403 }
      );
    }
    if (!organizationId) {
      return NextResponse.json(
        { error: "No active organization found" },
        { status: 400 }
      );
    }

    const role = await getUserOrgRole(userId, organizationId);
    if (role !== Role.ORG_OWNER) {
      return NextResponse.json(
        { error: "Only the organization owner can start checkout" },
        { status: 403 }
      );
    }

    const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid billing plan" }, { status: 400 });
    }

    if (!isPolarEnabled()) {
      return NextResponse.json(
        { error: "Polar billing is not configured" },
        { status: 503 }
      );
    }

    const [org, config, products] = await Promise.all([
      db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: {
          id: true,
          polarCustomerId: true,
          subscriptionStatus: true,
          subscriptionEndsAt: true,
        },
      }),
      Promise.resolve(getPolarConfig()),
      Promise.resolve(getPolarProducts()),
    ]);

    if (!org?.polarCustomerId) {
      return NextResponse.json(
        { error: "Billing customer setup is incomplete. Please refresh and try again." },
        { status: 409 }
      );
    }
    if (!config || !products) {
      return NextResponse.json(
        { error: "Polar billing configuration is incomplete" },
        { status: 503 }
      );
    }

    const hasCurrentSubscription =
      org.subscriptionStatus === "active" ||
      org.subscriptionStatus === "past_due" ||
      (org.subscriptionStatus === "canceled" &&
        Boolean(
          org.subscriptionEndsAt &&
            new Date(org.subscriptionEndsAt).getTime() > Date.now()
        ));
    if (hasCurrentSubscription) {
      return NextResponse.json(
        {
          error:
            "This organization already has a subscription. Use Manage subscription to change the plan.",
          code: "subscription_exists",
        },
        { status: 409 }
      );
    }

    const { Polar } = await import("@polar-sh/sdk");
    const polar = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });
    const appUrl = getAppUrl(request);
    const productId =
      parsed.data.plan === "plus"
        ? products.plusProductId
        : products.proProductId;

    const checkout = await polar.checkouts.create({
      customerId: org.polarCustomerId,
      products: [productId],
      successUrl: `${appUrl}/billing/success?checkout_id={CHECKOUT_ID}`,
      returnUrl: `${appUrl}/subscribe`,
      metadata: { referenceId: organizationId },
      allowDiscountCodes: true,
    });

    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[Billing] Failed to create Polar checkout:", error);
    return NextResponse.json(
      { error: "Failed to start billing checkout" },
      { status: 502 }
    );
  }
}
