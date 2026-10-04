/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { query: { organization: { findFirst: jest.fn() } } } }));
jest.mock("@/lib/feature-flags", () => ({ isPolarEnabled: () => true, getPolarConfig: () => ({ accessToken: "test", server: "sandbox" }) }));

import { db } from "@/utils/db";
import { ensurePolarCustomerAndLink } from "./organization-customer";

const findFirst = db.query.organization.findFirst as jest.Mock;
describe("customer provisioning failure policy", () => {
  beforeEach(() => jest.clearAllMocks());
  it("preserves a previously linked customer", async () => {
    findFirst.mockResolvedValue({ polarCustomerId: "customer-existing" });
    await expect(ensurePolarCustomerAndLink("owner", "owner@example.com", "Owner", "org"))
      .resolves.toBe("customer-existing");
  });
  it("propagates infrastructure failures for checkout", async () => {
    const error = new Error("database unavailable");
    findFirst.mockRejectedValue(error);
    await expect(ensurePolarCustomerAndLink("owner", "owner@example.com", "Owner", "org", { throwOnError: true }))
      .rejects.toBe(error);
  });
  it("keeps post-commit organization setup retryable without reporting creation failed", async () => {
    findFirst.mockRejectedValue(new Error("database unavailable"));
    await expect(ensurePolarCustomerAndLink("owner", "owner@example.com", "Owner", "org"))
      .resolves.toBeNull();
  });
});
