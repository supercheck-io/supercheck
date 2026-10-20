/** @jest-environment node */
import { generateSreEvidenceBrief } from "./sre-evidence";
import { subscriptionService, SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { runSreEvidenceBriefGeneration } from "@/lib/sre/evidence-brief-orchestrator";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

jest.mock("@/lib/project-context", () => ({ requireProjectContext: async () => ({
  userId: "user", organizationId: "org", project: { id: "project" },
}) }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({ checkSreEvidenceBriefRateLimit: async () => ({ allowed: true }) }));
jest.mock("@/lib/sre/evidence-brief-generator", () => ({ generateEvidenceBrief: jest.fn() }));
jest.mock("@/lib/sre/evidence-brief-orchestrator", () => ({ runSreEvidenceBriefGeneration: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/services/subscription-service", () => ({
  SubscriptionAccessDeniedError: class extends Error {},
  subscriptionService: {
    blockUntilSubscribed: jest.fn(async () => {}),
    requireValidPolarCustomer: jest.fn(async () => {}),
  },
}));
const input = { incidentId: "018f0000-0000-7000-8000-000000000001" };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(checkPermissionWithContext).mockReturnValue(true);
  jest.mocked(subscriptionService.blockUntilSubscribed).mockReset().mockResolvedValue();
  jest.mocked(subscriptionService.requireValidPolarCustomer).mockReset().mockResolvedValue();
  jest.mocked(runSreEvidenceBriefGeneration).mockResolvedValue({ success: false, error: "No incident" });
});
it.each(["blockUntilSubscribed", "requireValidPolarCustomer"] as const)(
  "blocks direct evidence-generation actions when %s denies access", async (guard) => {
    jest.mocked(subscriptionService[guard]).mockRejectedValue(new SubscriptionAccessDeniedError("Subscription required", "subscription_required"));
    expect(await generateSreEvidenceBrief(input)).toEqual({ success: false, error: "Subscription required" });
    expect(runSreEvidenceBriefGeneration).not.toHaveBeenCalled();
  },
);
it("passes permitted requests through existing subscription checks", async () => {
  expect(await generateSreEvidenceBrief(input)).toEqual({ success: false, error: "No incident" });
  expect(subscriptionService.blockUntilSubscribed).toHaveBeenCalledWith("org");
  expect(subscriptionService.requireValidPolarCustomer).toHaveBeenCalledWith("org");
  expect(runSreEvidenceBriefGeneration).toHaveBeenCalled();
});
it("checks permissions before subscription or model work", async () => {
  jest.mocked(checkPermissionWithContext).mockReturnValue(false);
  expect(await generateSreEvidenceBrief(input)).toEqual({ success: false, error: "Insufficient permissions to investigate this incident" });
  expect(subscriptionService.blockUntilSubscribed).not.toHaveBeenCalled();
  expect(runSreEvidenceBriefGeneration).not.toHaveBeenCalled();
});
