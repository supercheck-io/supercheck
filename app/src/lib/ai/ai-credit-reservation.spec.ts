/** @jest-environment node */

jest.mock("@/lib/services/usage-tracker", () => ({
  usageTracker: { consumeAICredit: jest.fn(), refundAICredit: jest.fn() },
}));

import { usageTracker } from "@/lib/services/usage-tracker";
import { reserveAICredit } from "./ai-credit-reservation";

describe("reserveAICredit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refunds a reservation at most once", async () => {
    jest.mocked(usageTracker.consumeAICredit).mockResolvedValue({ allowed: true });
    const r = await reserveAICredit("org", "ai_fix");
    await Promise.all([r.refund(), r.refund()]);
    await r.refund();
    expect(usageTracker.refundAICredit).toHaveBeenCalledTimes(1);
  });

  it("never refunds when the credit was not granted", async () => {
    jest.mocked(usageTracker.consumeAICredit).mockResolvedValue({ allowed: false, status: 429 });
    const r = await reserveAICredit("org", "ai_fix");
    await r.refund();
    expect(r.allowed).toBe(false);
    expect(usageTracker.refundAICredit).not.toHaveBeenCalled();
  });

  it("swallows refund failures", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(usageTracker.consumeAICredit).mockResolvedValue({ allowed: true });
    jest.mocked(usageTracker.refundAICredit).mockRejectedValue(new Error("db"));
    const r = await reserveAICredit("org", "ai_fix");
    await expect(r.refund()).resolves.toBeUndefined();
  });
});
