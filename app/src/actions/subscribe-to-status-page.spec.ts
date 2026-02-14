jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: {
        findFirst: jest.fn(),
      },
      statusPageSubscribers: {
        findFirst: jest.fn(),
      },
    },
    delete: jest.fn(),
    insert: jest.fn(),
  },
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/webhook-utils", () => ({
  generateWebhookSecret: jest.fn(() => "test-webhook-secret"),
}));

import { db } from "@/utils/db";
import { subscribeToStatusPage } from "./subscribe-to-status-page";

const mockDb = db as jest.Mocked<typeof db>;

describe("subscribeToStatusPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (
      mockDb.query.statusPages.findFirst as unknown as jest.Mock
    ).mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000123",
      status: "published",
      allowPageSubscribers: true,
      allowIncidentSubscribers: false,
      allowEmailSubscribers: true,
      allowWebhookSubscribers: true,
      allowSlackSubscribers: true,
      name: "Test Status Page",
      subdomain: "test",
    } as never);

    (
      mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock
    ).mockResolvedValue(null);

    (mockDb.delete as jest.Mock).mockImplementation(() => ({
      where: jest.fn().mockResolvedValue(undefined),
    }));

    (mockDb.insert as jest.Mock).mockImplementation(() => ({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([
          {
            id: "00000000-0000-0000-0000-000000000999",
          },
        ]),
      }),
    }));
  });

  it("allows non-incident webhook subscriptions when incident subscribers are disabled", async () => {
    const result = await subscribeToStatusPage({
      statusPageId: "00000000-0000-0000-0000-000000000123",
      subscriptionMode: "webhook",
      endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true,
      subscribeToAllIncidents: false,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Webhook subscription successful");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("blocks explicit incident-interest subscriptions when incident subscribers are disabled", async () => {
    const result = await subscribeToStatusPage({
      statusPageId: "00000000-0000-0000-0000-000000000123",
      subscriptionMode: "webhook",
      endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true,
      subscribeToAllIncidents: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "Incident subscriptions are disabled for this status page"
    );
    expect(mockDb.query.statusPageSubscribers.findFirst).not.toHaveBeenCalled();
  });
});
