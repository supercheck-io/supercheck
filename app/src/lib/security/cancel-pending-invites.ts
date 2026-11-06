import { and, eq } from "drizzle-orm";
import { invitation } from "@/db/schema";
import type { db } from "@/utils/db";

type Executor = Pick<typeof db, "update">;

/** Cancel the pending invitations a user sent for one organization when they lose the right to invite. */
export async function cancelPendingInvitesByInviter(tx: Executor, inviterId: string, organizationId: string) {
  await tx
    .update(invitation)
    .set({ status: "cancelled" })
    .where(and(
      eq(invitation.inviterId, inviterId),
      eq(invitation.organizationId, organizationId),
      eq(invitation.status, "pending"),
    ));
}
