/** @jest-environment node */

jest.mock("@/lib/sre/collaboration-signatures", () => ({
  verifySlackRequestSignature: jest.fn(),
}));

jest.mock("@/lib/sre/collaboration-webhooks", () => ({
  claimSreCollaborationWebhook: jest.fn(),
  processSreCollaborationMessage: jest.fn(),
  updateSreCollaborationWebhookResult: jest.fn(),
}));

import { verifySlackRequestSignature } from "@/lib/sre/collaboration-signatures";
import { claimSreCollaborationWebhook, processSreCollaborationMessage, updateSreCollaborationWebhookResult } from "@/lib/sre/collaboration-webhooks";
import { POST } from "./route";

const mockVerifySlackRequestSignature = verifySlackRequestSignature as jest.Mock;
const mockClaimSreCollaborationWebhook = claimSreCollaborationWebhook as jest.Mock;
const mockProcessSreCollaborationMessage = processSreCollaborationMessage as jest.Mock;
const mockUpdateSreCollaborationWebhookResult = updateSreCollaborationWebhookResult as jest.Mock;

describe("Slack SRE webhook route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifySlackRequestSignature.mockReturnValue(true);
    mockClaimSreCollaborationWebhook.mockResolvedValue(true);
    mockProcessSreCollaborationMessage.mockResolvedValue({ status: "investigated" });
    mockUpdateSreCollaborationWebhookResult.mockResolvedValue(undefined);
  });

  it("rejects invalid signatures before idempotency or processing", async () => {
    mockVerifySlackRequestSignature.mockReturnValue(false);

    const response = await POST(new Request("http://localhost/api/webhooks/slack", { method: "POST", body: "{}" }));

    expect(response.status).toBe(401);
    expect(mockClaimSreCollaborationWebhook).not.toHaveBeenCalled();
    expect(mockProcessSreCollaborationMessage).not.toHaveBeenCalled();
  });

  it("responds to Slack URL verification after signature verification", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body: JSON.stringify({ type: "url_verification", challenge: "challenge-1" }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ challenge: "challenge-1" });
    expect(mockProcessSreCollaborationMessage).not.toHaveBeenCalled();
  });

  it("claims and processes Slack message events once", async () => {
    const payload = {
      type: "event_callback",
      event_id: "Ev123",
      event: {
        type: "message",
        text: "investigate 018f0000-0000-7000-8000-000000000005",
        channel: "C123",
        ts: "1710000000.000100",
        user: "U123",
      },
    };

    const response = await POST(
      new Request("http://localhost/api/webhooks/slack", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(200);
    expect(mockClaimSreCollaborationWebhook).toHaveBeenCalledWith("Ev123", "slack.event_callback");
    expect(mockProcessSreCollaborationMessage).toHaveBeenCalledWith({
      provider: "slack",
      deliveryId: "Ev123",
      text: "investigate 018f0000-0000-7000-8000-000000000005",
      channelId: "C123",
      threadTs: "1710000000.000100",
      responderId: "U123",
    });
    expect(mockUpdateSreCollaborationWebhookResult).toHaveBeenCalledWith({
      deliveryId: "Ev123",
      eventType: "slack.event_callback",
      status: "success",
      message: "investigated",
    });
  });
});
