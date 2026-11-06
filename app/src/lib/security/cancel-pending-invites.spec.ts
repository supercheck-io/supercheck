/** @jest-environment node */
import { cancelPendingInvitesByInviter } from "./cancel-pending-invites";
import { invitation } from "@/db/schema";

describe("cancelPendingInvitesByInviter", () => {
  it("cancels only the pending invitations the user sent for that organization", async () => {
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    const update = jest.fn().mockReturnValue({ set });
    await cancelPendingInvitesByInviter({ update } as never, "user-1", "org-1");
    expect(update).toHaveBeenCalledWith(invitation);
    expect(set).toHaveBeenCalledWith({ status: "cancelled" });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
