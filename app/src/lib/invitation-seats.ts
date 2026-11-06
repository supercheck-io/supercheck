import { and, eq, gte, sql } from "drizzle-orm";
import { invitation, user as userTable } from "@/db/schema";

/**
 * Pending, unexpired invitations that reserve a member seat. An invitation to a
 * platform administrator's address is excluded: it can never be accepted, so it
 * must not consume a seat. The invite response stays identical either way.
 */
export function seatReservingInvitations(organizationId: string) {
  return and(
    eq(invitation.organizationId, organizationId),
    eq(invitation.status, "pending"),
    gte(invitation.expiresAt, new Date()),
    sql`NOT EXISTS (SELECT 1 FROM ${userTable} WHERE LOWER(${userTable.email}) = LOWER(${invitation.email}) AND ${userTable.role} = 'super_admin')`,
  );
}
