/** @jest-environment node */
const blockUntilSubscribed = jest.fn();
jest.mock("@/lib/services/subscription-service", () => ({
  subscriptionService: { blockUntilSubscribed: (...a: unknown[]) => blockUntilSubscribed(...a) },
  SubscriptionAccessDeniedError: class extends Error {
    constructor(message: string, readonly reason: string) { super(message); }
  },
}));
import { SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { lapsedWriteBlock } from "./lapsed-org-gate";

describe("lapsedWriteBlock", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows paid organizations, trials and self-hosted (blockUntilSubscribed resolves)", async () => {
    blockUntilSubscribed.mockResolvedValue(undefined);
    await expect(lapsedWriteBlock("org-1")).resolves.toBeNull();
    expect(blockUntilSubscribed).toHaveBeenCalledWith("org-1");
  });

  it("blocks a lapsed organization with the server's message and code", async () => {
    blockUntilSubscribed.mockRejectedValue(new (SubscriptionAccessDeniedError as unknown as new (m: string, r: string) => Error)("Active subscription required. Visit /billing to subscribe to Plus or Pro.", "subscription_required"));
    await expect(lapsedWriteBlock("org-1")).resolves.toEqual({ ok: false, code: "subscription_required", error: "Active subscription required. Visit /billing to subscribe to Plus or Pro." });
  });

  it("does not hide other failures", async () => {
    blockUntilSubscribed.mockRejectedValue(new Error("db down"));
    await expect(lapsedWriteBlock("org-1")).rejects.toThrow("db down");
  });
});
