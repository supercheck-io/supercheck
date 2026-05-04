jest.mock("@/lib/url-validator", () => ({
  fetchSafeExternalUrl: jest.fn(),
  validateWebhookUrlString: jest.fn(),
}));

import {
  fetchSafeExternalUrl,
  validateWebhookUrlString,
} from "@/lib/url-validator";
import { deliverWebhook, type WebhookEvent } from "./webhook-delivery.service";

const mockFetchSafeExternalUrl = fetchSafeExternalUrl as jest.Mock;
const mockValidateWebhookUrlString = validateWebhookUrlString as jest.Mock;

describe("webhook-delivery.service", () => {
  const event: WebhookEvent = {
    type: "incident.created",
    timestamp: "2026-04-24T00:00:00.000Z",
    statusPageId: "status-page-1",
    incident: {
      id: "incident-1",
      name: "Incident",
      status: "investigating",
      impact: "major",
      body: "Details",
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateWebhookUrlString.mockReturnValue({ valid: true });
    mockFetchSafeExternalUrl.mockResolvedValue(new Response("ok", { status: 200 }));
  });

  it("delivers through the safe outbound URL client", async () => {
    await expect(
      deliverWebhook("https://example.com/hooks/status", event, "secret-value"),
    ).resolves.toEqual({
      success: true,
      statusCode: 200,
      retriesAttempted: 0,
    });

    expect(mockFetchSafeExternalUrl).toHaveBeenCalledWith(
      "https://example.com/hooks/status",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Webhook-Event": "incident.created",
          "X-Webhook-Timestamp": event.timestamp,
        }),
        body: JSON.stringify(event),
      }),
    );
  });
});
