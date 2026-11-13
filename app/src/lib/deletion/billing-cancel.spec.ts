/** @jest-environment node */
const mockGet = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true, getPolarConfig: () => ({ accessToken: "t", server: "sandbox" }), isSelfHosted: () => false }));
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: () => ({ subscriptions: { get: (...a: unknown[]) => mockGet(...a), update: (...a: unknown[]) => mockUpdate(...a) } }) }));
import { BillingCancellationError, BillingPreWriteError, cancelSubscriptionAtPeriodEnd } from "./billing";

const org = { id: "o1", subscriptionId: "sub_1", polarCustomerId: "cus_1" };
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, "error").mockImplementation(() => undefined); });

describe("cancelSubscriptionAtPeriodEnd failure kinds", () => {
  it("a failure while reading the subscription is a pre-write failure", async () => {
    mockGet.mockRejectedValue(new Error("provider down"));
    await expect(cancelSubscriptionAtPeriodEnd(org)).rejects.toBeInstanceOf(BillingPreWriteError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("a failure of the change itself may have been applied, so it is not a pre-write failure", async () => {
    mockGet.mockResolvedValue({ cancel_at_period_end: false, status: "active" });
    mockUpdate.mockRejectedValue(new Error("timeout"));
    const error = await cancelSubscriptionAtPeriodEnd(org).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BillingCancellationError);
    expect(error).not.toBeInstanceOf(BillingPreWriteError);
  });
});
