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
import { PlanLimitBusyError, withPlanLimitLock } from "@/lib/middleware/plan-limit-lock";

const bodySchema = z.object({
  organizationId: z.string().uuid(),
  totalMembers: z.number().int().min(PRO_INCLUDED_MEMBERS).max(MAX_MEMBER_SEATS),
  // The seat total the owner saw when previewing the change; the charge direction depends on it.
  expectedCurrentMembers: z.number().int().min(1).max(10_000),
}).strict();

/** Safe messages for the provider's documented subscription-update failures. */
const POLAR_ERRORS: Record<number, { status: number; error: string }> = {
  402: { status: 402, error: "The charge for the new seats failed. Update your payment method under Manage subscription, then try again." },
  403: { status: 409, error: "Member seats can't be changed on this subscription right now. Contact support if this persists." },
  404: { status: 409, error: "Subscription not found. Refresh the page and try again." },
  409: { status: 409, error: "A subscription change is already pending. Try again in a few minutes." },
  422: { status: 409, error: "Member seats aren't available on this subscription yet. Contact support to add seats." },
};

function providerError(error: unknown) {
  const statusCode = (error as { statusCode?: unknown })?.statusCode;
  const mapped = typeof statusCode === "number" ? POLAR_ERRORS[statusCode] : undefined;
  console.error(`[Billing] Member seat request to the billing provider failed (status ${String(statusCode ?? "unknown")})`);
  return NextResponse.json(
    { error: mapped?.error ?? "Could not change member seats. Try again later." },
    { status: mapped?.status ?? 502 },
  );
}

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
    // Seats change what the owner's card is charged, like checkout and the customer portal.
    if (orgRole !== Role.ORG_OWNER) {
      return NextResponse.json({ error: "Only the organization owner can change member seats" }, { status: 403 });
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
    const { totalMembers, expectedCurrentMembers } = parsed.data;

    if (!isPolarEnabled()) {
      return NextResponse.json({ error: "Member seats are only sold on Supercheck Cloud" }, { status: 400 });
    }
    const access = await subscriptionService.getSubscriptionAccessStatus(organizationId);
    if (!access.isActive || access.plan !== "pro") {
      return NextResponse.json({ error: "Extra member seats are available on the Pro plan. Upgrade to Pro to add members." }, { status: 400 });
    }
    const plan = await subscriptionService.getPlanLimits("pro");
    const summary = (memberUnits: number | null, used: number | null) => ({
      included: plan.maxTeamMembers,
      purchasedSeats: memberUnits,
      limit: effectiveMemberLimit(plan, memberUnits),
      used,
      extraMemberPriceCents: EXTRA_MEMBER_PRICE_CENTS,
    });
    const config = getPolarConfig()!;
    const polar = createPolarClient({ accessToken: config.accessToken, server: config.server });

    // One seat change at a time per organization, serialized with invitations and acceptances (same lock),
    // so the floor below and the seats written stay consistent. The org row lock also holds off webhooks
    // for this organization until the change is stored.
    let applied: { before: number; units: number } | null = null;
    let outcome: NextResponse;
    try {
      outcome = await withPlanLimitLock(organizationId, "members", async (tx) => {
        const [org] = await tx.select({
          subscriptionId: organization.subscriptionId,
          memberUnits: organization.memberUnits,
          polarWebhookTimestamp: organization.polarWebhookTimestamp,
        })
          .from(organization).where(eq(organization.id, organizationId)).for("update");
        if (!org?.subscriptionId) {
          return NextResponse.json({ error: "Subscription not found. Refresh the page and try again." }, { status: 409 });
        }
        const inUse = await countSeatsInUse(tx, organizationId);
        const floor = Math.max(plan.maxTeamMembers, inUse);
        if (totalMembers < floor) {
          return NextResponse.json(
            { error: `You have ${inUse} members and pending invitations, and Pro includes ${plan.maxTeamMembers}. Choose at least ${floor} seats, or remove members first.` },
            { status: 400 },
          );
        }

        // Compare with the provider's live seats, not the local copy, which can lag a change.
        let live: number | null;
        let version: string | null;
        try {
          const subscription = await polar.subscriptions.get(org.subscriptionId);
          live = subscription.units ?? null;
          version = subscription.modified_at ?? null;
        } catch (error) {
          return providerError(error);
        }
        if (live === null) {
          // The subscription carries no seat price, so seats cannot be changed.
          return NextResponse.json({ error: POLAR_ERRORS[422].error }, { status: 409 });
        }
        const currentLimit = effectiveMemberLimit(plan, live);
        if (currentLimit !== expectedCurrentMembers) {
          // Another tab or a sync changed the seats since the preview: a previewed credit could become a charge.
          return NextResponse.json(
            { error: "Member seats changed since you opened this. Refresh and try again.", code: "seats_changed" },
            { status: 409 },
          );
        }
        let units = live;
        if (totalMembers !== currentLimit) {
          try {
            const updated = await polar.subscriptions.update(org.subscriptionId, {
              units: totalMembers,
              // An increase is charged now; a decrease is credited on the next invoice.
              proration_behavior: totalMembers > currentLimit ? "invoice" : "prorate",
            });
            units = updated.units ?? live;
            version = updated.modified_at ?? new Date().toISOString();
          } catch (error) {
            return providerError(error);
          }
          applied = { before: currentLimit, units };
        }
        if (units !== org.memberUnits) {
          // Advance the webhook ordering marker to this subscription version, so a delayed older
          // subscription event (or a stale reconciliation snapshot) cannot restore the previous seats.
          const at = version ? new Date(version) : null;
          const ordering = at && Number.isFinite(at.getTime()) &&
            (!org.polarWebhookTimestamp || at > org.polarWebhookTimestamp)
            ? { polarWebhookTimestamp: at, polarWebhookEventKey: `seats:${org.subscriptionId}:${at.toISOString()}` }
            : {};
          await tx.update(organization).set({ memberUnits: units, ...ordering })
            .where(and(eq(organization.id, organizationId), eq(organization.subscriptionId, org.subscriptionId)));
        }
        return NextResponse.json(summary(units, inUse));
      });
    } catch (error) {
      if (error instanceof PlanLimitBusyError) {
        return NextResponse.json({ error: "Another member change is in progress. Try again in a moment." }, { status: 409 });
      }
      if (!applied) throw error;
      // The provider already changed the subscription; its webhook stores the same seats shortly.
      console.error("[Billing] Member seats changed but not stored yet:", error);
      const changed: { before: number; units: number } = applied;
      outcome = NextResponse.json({ ...summary(changed.units, null), pending: true });
    }

    if (applied) {
      const changed: { before: number; units: number } = applied;
      await createAuditLog({
        organizationId,
        userId,
        action: "billing_member_seats_updated",
        details: {
          resource: "billing_member_seats",
          changes: { memberSeats: { before: changed.before, after: changed.units } },
        },
      });
    }
    return outcome;
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
