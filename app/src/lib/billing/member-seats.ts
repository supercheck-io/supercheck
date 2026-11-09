import { and, eq, gte, sql } from "drizzle-orm";
import { invitation, member } from "@/db/schema";
import type { db } from "@/utils/db";
import catalog from "./plan-catalog.json";

/** Monthly price of one Pro member above the plan's included members. */
export const EXTRA_MEMBER_PRICE_CENTS = catalog.pro.extraMemberPriceCents;
/** Members the Pro price includes (catalog default; the plan_limits row is authoritative for enforcement). */
export const PRO_INCLUDED_MEMBERS = catalog.pro.limits.maxTeamMembers;
/** Most members an organization can have; also the auth layer's membership limit, so they cannot drift. */
export const MAX_MEMBER_SEATS = catalog.pro.maxTotalMembers;

/**
 * Member limit for an organization: Pro may buy seats above its included members (seats count
 * total members, so the first included ones are free). Every other plan uses its own limit.
 */
export function effectiveMemberLimit(
  plan: { plan: string; maxTeamMembers: number },
  memberUnits: number | null | undefined,
): number {
  if (plan.plan !== "pro" || !memberUnits) return plan.maxTeamMembers;
  return Math.max(plan.maxTeamMembers, memberUnits);
}

/** Members plus unexpired pending invitations: an invitation reserves a seat until it is accepted or expires. */
export async function countSeatsInUse(
  executor: Pick<typeof db, "select">,
  organizationId: string,
): Promise<number> {
  // Sequential: the executor may be a transaction, which runs one query at a time.
  const [members] = await executor.select({ count: sql<number>`count(*)` }).from(member)
    .where(eq(member.organizationId, organizationId));
  const [pending] = await executor.select({ count: sql<number>`count(*)` }).from(invitation)
    .where(and(
      eq(invitation.organizationId, organizationId),
      eq(invitation.status, "pending"),
      gte(invitation.expiresAt, new Date()),
    ));
  return Number(members?.count || 0) + Number(pending?.count || 0);
}
