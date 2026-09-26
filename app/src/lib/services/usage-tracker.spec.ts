/** @jest-environment node */

jest.mock("@/utils/db", () => ({ db: { update: jest.fn(), select: jest.fn() } }));
jest.mock("./subscription-service", () => ({
  subscriptionService: { getOrganizationPlan: jest.fn() },
}));
jest.mock("@/lib/feature-flags", () => ({
  isCloudHosted: jest.fn(), isPolarEnabled: jest.fn(),
}));

import { db } from "@/utils/db";
import { isCloudHosted, isPolarEnabled } from "@/lib/feature-flags";
import { subscriptionService } from "./subscription-service";
import { UsageTracker } from "./usage-tracker";

describe("AI credit admission", () => {
  const tracker = new UsageTracker();
  const returning = jest.fn();
  const limit = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(isCloudHosted).mockReturnValue(true);
    jest.mocked(isPolarEnabled).mockReturnValue(true);
    jest.mocked(subscriptionService.getOrganizationPlan).mockResolvedValue({
      plan: "plus", aiCreditsIncluded: 100,
    } as Awaited<ReturnType<typeof subscriptionService.getOrganizationPlan>>);
    jest.mocked(db.update).mockReturnValue({ set: () => ({ where: () => ({ returning }) }) } as never);
    jest.mocked(db.select).mockReturnValue({ from: () => ({ where: () => ({ limit }) }) } as never);
    returning.mockResolvedValue([{ aiCreditsUsed: 100 }]);
    limit.mockResolvedValue([{ aiCreditsUsed: 100 }]);
  });

  it("admits the final included credit and denies further usage", async () => {
    await expect(tracker.consumeAICredit("org-1", "ai_create")).resolves.toMatchObject({ allowed: true, used: 100 });
    returning.mockResolvedValue([]);
    await expect(tracker.consumeAICredit("org-1", "ai_create")).resolves.toMatchObject({ allowed: false, status: 429, used: 100 });
  });

  it("denies usage if the atomic credit write fails", async () => {
    returning.mockRejectedValue(new Error("database unavailable"));
    await expect(tracker.consumeAICredit("org-1", "ai_fix")).resolves.toMatchObject({ allowed: false, status: 503 });
  });

  it("denies usage if subscription lookup fails", async () => {
    jest.mocked(subscriptionService.getOrganizationPlan).mockRejectedValue(new Error("subscription unavailable"));
    await expect(tracker.consumeAICredit("org-1", "ai_analyze")).resolves.toMatchObject({ allowed: false, status: 503 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("denies usage if the organization disappeared", async () => {
    returning.mockResolvedValue([]);
    limit.mockResolvedValue([]);
    await expect(tracker.consumeAICredit("org-1", "ai_fix")).resolves.toMatchObject({ allowed: false, status: 503 });
  });

  it("does not interpret missing cloud credentials as self-hosted", async () => {
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    await expect(tracker.consumeAICredit("org-1", "ai_fix")).resolves.toMatchObject({ allowed: false, status: 503 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("keeps self-hosted AI independent of Polar", async () => {
    jest.mocked(isCloudHosted).mockReturnValue(false);
    jest.mocked(isPolarEnabled).mockReturnValue(false);
    await expect(tracker.consumeAICredit("org-1", "ai_fix")).resolves.toEqual({ allowed: true });
    expect(db.update).not.toHaveBeenCalled();
  });
});
