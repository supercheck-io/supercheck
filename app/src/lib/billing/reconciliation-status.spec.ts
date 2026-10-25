/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { select: jest.fn() } }));
import { db } from "@/utils/db";
import { getBillingReconciliationStatus } from "./reconciliation-status";

describe("billing reconciliation visibility", () => {
  it("reports stranded usage and receipts without replaying or exposing customer data", async () => {
    jest.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: async () => [{ pendingEvents: 12, parkedEvents: 2, oldestPendingAt: new Date(0) }] }) } as never)
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ pendingReceipts: 3, parkedReceipts: 1 }] }) } as never);
    await expect(getBillingReconciliationStatus()).resolves.toEqual({ pendingEvents: 12, parkedEvents: 2,
      oldestPendingAt: new Date(0), pendingReceipts: 3, parkedReceipts: 1, requiresAttention: true });
  });
  it("does not alert for an empty outbox", async () => {
    jest.mocked(db.select).mockReturnValueOnce({ from: () => ({ where: async () => [{ pendingEvents: 0, parkedEvents: 0, oldestPendingAt: null }] }) } as never)
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ pendingReceipts: 0, parkedReceipts: 0 }] }) } as never);
    await expect(getBillingReconciliationStatus()).resolves.toMatchObject({ requiresAttention: false });
  });
});
