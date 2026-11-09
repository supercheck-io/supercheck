import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { organization } from "@/db/schema";
import { requireUserAuthContext, isAuthError, authErrorStatus } from "@/lib/auth-context";
import { getPolarConfig, isPolarEnabled } from "@/lib/feature-flags";
import { getUserOrgRole, getImpersonationState } from "@/lib/rbac/middleware";
import { Role } from "@/lib/rbac/permissions";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { subscriptionService } from "@/lib/services/subscription-service";
import { createPolarClient } from "@/lib/billing/polar-client";
import {
  countSeatsInUse,
  effectiveMemberLimit,
  EXTRA_MEMBER_PRICE_CENTS,
  MAX_MEMBER_SEATS,
  PRO_INCLUDED_MEMBERS,
} from "@/lib/billing/member-seats";
import { createAuditLog } from "@/lib/audit-log";
import { db } from "@/utils/db";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  totalMembers: z.number().int().min(PRO_INCLUDED_MEMBERS).max(MAX_MEMBER_SEATS),
}).strict();

/** Safe messages for the provider's documented subscription-update failures. */
const POLAR_ERRORS: Record<number, { status: number; error: string }> = {
  402: { status: 402, error: "The charge for the new seats failed. Update your payment method under Manage subscription, then try again." },
  403: { status: 409, error: "Member seats can't be changed on this subscription right now. Contact support if this persists." },
  404: { status: 409, error: "Subscription not found. Refresh the page and try again." },
  409: { status: 409, error: "A subscription change is already pending. Try again in a few minutes." },
  422: { status: 409, error: "Member seats aren't available on this subscription yet. Contact support to add seats." },
};

/**
 * POST /api/billing/members
 * Set the total member seats of the active Pro organization. Seats above the plan's included members
 * are billed monthly; Polar invoices an increase prorated now and credits a decrease.
 */
export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  try {
    const { userId, organizationId, isCliAuth } = await requireUserAuthContext();
    if (isCliAuth) {
      return NextResponse.json({ error: "Organization administration requires an interactive browser session; CLI tokens are project-scoped" }, { status: 403 });
    }
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization found" }, { status: 400 });
    }

    const orgRole = await getUserOrgRole(userId, organizationId);
    if (orgRole !== Role.ORG_ADMIN && orgRole !== Role.ORG_OWNER) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    const impersonation = await getImpersonationState();
    if (impersonation === "unknown") {
      return NextResponse.json({ error: "Could not verify your session. Please try again." }, { status: 503 });
    }
    if (impersonation === "impersonated") {
      return NextResponse.json({ error: "Member seats cannot be changed while impersonating a user" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Choose a whole number of members from ${PRO_INCLUDED_MEMBERS} to ${MAX_MEMBER_SEATS}.` },
        { status: 400 },
      );
    }
    if (parsed.data.organizationId !== organizationId) {
      return NextResponse.json({ error: "Selected organization changed. Refresh before changing member seats." }, { status: 409 });
    }
    const { totalMembers } = parsed.data;

    if (!isPolarEnabled()) {
      return NextResponse.json({ error: "Member seats are only sold on Supercheck Cloud" }, { status: 400 });
    }
    const access = await subscriptionService.getSubscriptionAccessStatus(organizationId);
    if (!access.isActive || access.plan !== "pro") {
      return NextResponse.json({ error: "Extra member seats are available on the Pro plan. Upgrade to Pro to add members." }, { status: 400 });
    }
    const org = await db.query.organization.findFirst({ where: eq(organization.id, organizationId) });
    if (!org?.subscriptionId) {
      return NextResponse.json({ error: "Subscription not found. Refresh the page and try again." }, { status: 409 });
    }

    const plan = await subscriptionService.getPlanLimits("pro");
    const inUse = await countSeatsInUse(db, organizationId);
    const floor = Math.max(plan.maxTeamMembers, inUse);
    if (totalMembers < floor) {
      return NextResponse.json(
        { error: `You have ${inUse} members and pending invitations, and Pro includes ${plan.maxTeamMembers}. Choose at least ${floor} seats, or remove members first.` },
        { status: 400 },
      );
    }

    const summary = (memberUnits: number | null) => ({
      included: plan.maxTeamMembers,
      purchasedSeats: memberUnits,
      limit: effectiveMemberLimit(plan, memberUnits),
      used: inUse,
      extraMemberPriceCents: EXTRA_MEMBER_PRICE_CENTS,
    });
    if (totalMembers === effectiveMemberLimit(plan, org.memberUnits)) {
      return NextResponse.json(summary(org.memberUnits));
    }

    // Outside any transaction: the provider call can take seconds. An invite accepted meanwhile can leave
    // the organization one member over a lowered limit, which only blocks further invites.
    const config = getPolarConfig()!;
    let units: number | null;
    try {
      const subscription = await createPolarClient({ accessToken: config.accessToken, server: config.server })
        .subscriptions.update(org.subscriptionId, { units: totalMembers, proration_behavior: "invoice" });
      units = subscription.units ?? null;
    } catch (error) {
      const statusCode = (error as { statusCode?: unknown })?.statusCode;
      const mapped = typeof statusCode === "number" ? POLAR_ERRORS[statusCode] : undefined;
      console.error(`[Billing] Member seat update failed (status ${String(statusCode ?? "unknown")})`);
      return NextResponse.json(
        { error: mapped?.error ?? "Could not change member seats. Try again later." },
        { status: mapped?.status ?? 502 },
      );
    }
    if (units === null) {
      // The subscription carries no seat price, so the change did not apply.
      return NextResponse.json({ error: POLAR_ERRORS[422].error }, { status: 409 });
    }

    // The provider has changed (and may have charged) the subscription: record that before anything else can fail.
    await createAuditLog({
      organizationId,
      userId,
      action: "billing_member_seats_updated",
      details: {
        resource: "billing_member_seats",
        changes: { memberSeats: { before: effectiveMemberLimit(plan, org.memberUnits), after: units } },
      },
    });
    // Bound to the subscription we changed, so a replacement written meanwhile by a webhook is not overwritten.
    // If this write fails, the provider's subscription.updated webhook stores the same seats shortly.
    const stored = await db.update(organization).set({ memberUnits: units })
      .where(and(eq(organization.id, organizationId), eq(organization.subscriptionId, org.subscriptionId)))
      .returning({ id: organization.id })
      .catch((error) => {
        console.error("[Billing] Member seats changed but not stored yet:", error);
        return null;
      });
    if (stored === null) {
      return NextResponse.json({ ...summary(units), pending: true });
    }
    if (stored.length === 0) {
      return NextResponse.json({ error: "Your subscription changed while saving. Refresh the page to see your member seats." }, { status: 409 });
    }

    return NextResponse.json(summary(units));
  } catch (error) {
    if (isAuthError(error)) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Authentication required" },
        { status: authErrorStatus(error) },
      );
    }
    console.error("[Billing] Failed to change member seats:", error);
    return NextResponse.json({ error: "Failed to change member seats" }, { status: 500 });
  }
}
