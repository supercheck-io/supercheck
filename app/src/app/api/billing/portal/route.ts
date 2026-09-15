import { NextRequest, NextResponse } from "next/server";

import { organization } from "@/db/schema";
import { requireUserAuthContext, isAuthError } from "@/lib/auth-context";
import { getPolarConfig, isPolarEnabled } from "@/lib/feature-flags";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { db } from "@/utils/db";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json(
        { error: "Customer portal access requires an interactive browser session" },
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
        { error: "Only the organization owner can open the customer portal" },
        { status: 403 }
      );
    }

    if (!isPolarEnabled()) {
      return NextResponse.json(
        { error: "Polar billing is not configured" },
        { status: 503 }
      );
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { polarCustomerId: true },
    });
    const config = getPolarConfig();
    if (!org?.polarCustomerId || !config) {
      return NextResponse.json(
        { error: "Billing customer setup is incomplete" },
        { status: 409 }
      );
    }

    const configuredUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL;
    const appUrl = new URL(configuredUrl || request.nextUrl.origin);
    if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
      throw new Error("Production billing requires an HTTPS application URL");
    }

    const { Polar } = await import("@polar-sh/sdk");
    const polar = new Polar({
      accessToken: config.accessToken,
      server: config.server,
    });
    const session = await polar.customerSessions.create({
      customerId: org.polarCustomerId,
      returnUrl: `${appUrl.origin}/org-admin?tab=subscription`,
    });

    return NextResponse.json({ url: session.customerPortalUrl });
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: 401 }
      );
    }
    console.error("[Billing] Failed to create Polar customer portal session:", error);
    return NextResponse.json(
      { error: "Failed to open customer portal" },
      { status: 502 }
    );
  }
}
