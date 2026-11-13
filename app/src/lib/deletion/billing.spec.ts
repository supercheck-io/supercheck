/** @jest-environment node */
let mockSelfHosted = false;
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => false, getPolarConfig: () => null, isSelfHosted: () => mockSelfHosted }));
jest.mock("@/lib/billing/polar-client", () => ({ createPolarClient: jest.fn() }));

import { BillingCancellationError, revokeRemainingSubscription } from "./billing";

describe("revokeRemainingSubscription without a configured provider", () => {
  const customerOnly = { id: "o1", subscriptionId: null, polarCustomerId: "cus_1" };

  it("fails closed on cloud when only a provider customer is stored (its subscription may not be recorded yet)", async () => {
    mockSelfHosted = false;
    await expect(revokeRemainingSubscription(customerOnly)).rejects.toBeInstanceOf(BillingCancellationError);
  });

  it("is a no-op on self-hosted and for organizations that never had billing", async () => {
    mockSelfHosted = true;
    await expect(revokeRemainingSubscription(customerOnly)).resolves.toEqual({ subscriptionId: null });
    mockSelfHosted = false;
    await expect(revokeRemainingSubscription({ id: "o2", subscriptionId: null, polarCustomerId: null })).resolves.toEqual({ subscriptionId: null });
  });
});
