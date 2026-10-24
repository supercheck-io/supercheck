jest.mock("@/utils/db", () => ({ db: { query: { statusPages: { findFirst: jest.fn() } }, select: jest.fn(), update: jest.fn() } }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn(async () => ({ userId: "user", organizationId: "org", project: { id: "project" } })) }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const blockUntilSubscribed = jest.fn();
const requireValidPolarCustomer = jest.fn();
jest.mock("@/lib/services/subscription-service", () => {
  class SubscriptionAccessDeniedError extends Error {
    constructor(message: string, readonly reason?: string) {
      super(message);
    }
  }
  return {
    SubscriptionAccessDeniedError,
    subscriptionService: {
      blockUntilSubscribed: (...args: unknown[]) => blockUntilSubscribed(...args),
      requireValidPolarCustomer: (...args: unknown[]) => requireValidPolarCustomer(...args),
    },
  };
});
import { db } from "@/utils/db";
import { SubscriptionAccessDeniedError } from "@/lib/services/subscription-service";
import { publishStatusPage } from "./publish-status-page";

const pageId = "00000000-0000-4000-8000-000000000001";

describe("publishStatusPage access", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    blockUntilSubscribed.mockResolvedValue(undefined);
    requireValidPolarCustomer.mockResolvedValue(undefined);
  });

  it("does not bring an archived page back online for an organization without access (expired trial)", async () => {
    blockUntilSubscribed.mockRejectedValue(new SubscriptionAccessDeniedError("Your free trial has ended. Subscribe to continue.", "subscription_required"));
    const result = await publishStatusPage(pageId);
    expect(result).toEqual({ success: false, message: "Your free trial has ended. Subscribe to continue." });
    expect(db.query.statusPages.findFirst).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("checks the subscription before looking at the page", async () => {
    jest.mocked(db.query.statusPages.findFirst).mockResolvedValue(undefined);
    await publishStatusPage(pageId);
    expect(blockUntilSubscribed).toHaveBeenCalledWith("org");
    expect(requireValidPolarCustomer).toHaveBeenCalledWith("org");
  });
});
