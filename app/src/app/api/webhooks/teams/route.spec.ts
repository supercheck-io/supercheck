/** @jest-environment node */

jest.mock("@/lib/sre/collaboration-signatures", () => ({
  verifyTeamsOutgoingWebhookSignature: jest.fn(),
}));

jest.mock("@/lib/sre/collaboration-webhooks", () => ({
  claimSreCollaborationWebhook: jest.fn(),
  processSreCollaborationMessage: jest.fn(),
  updateSreCollaborationWebhookResult: jest.fn(),
}));

import { verifyTeamsOutgoingWebhookSignature } from "@/lib/sre/collaboration-signatures";
import { claimSreCollaborationWebhook, processSreCollaborationMessage, updateSreCollaborationWebhookResult } from "@/lib/sre/collaboration-webhooks";
import { POST } from "./route";

const mockVerifyTeamsOutgoingWebhookSignature = verifyTeamsOutgoingWebhookSignature as jest.Mock;
const mockClaimSreCollaborationWebhook = claimSreCollaborationWebhook as jest.Mock;
const mockProcessSreCollaborationMessage = processSreCollaborationMessage as jest.Mock;
const mockUpdateSreCollaborationWebhookResult = updateSreCollaborationWebhookResult as jest.Mock;

describe("Teams SRE webhook route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyTeamsOutgoingWebhookSignature.mockReturnValue(true);
    mockClaimSreCollaborationWebhook.mockResolvedValue(true);
    mockProcessSreCollaborationMessage.mockResolvedValue({ status: "acknowledged" });
    mockUpdateSreCollaborationWebhookResult.mockResolvedValue(undefined);
  });

  it("rejects invalid Teams signatures before idempotency or processing", async () => {
    mockVerifyTeamsOutgoingWebhookSignature.mockReturnValue(false);

    const response = await POST(new Request("http://localhost/api/webhooks/teams", { method: "POST", body: "{}" }));

    expect(response.status).toBe(401);
    expect(mockClaimSreCollaborationWebhook).not.toHaveBeenCalled();
    expect(mockProcessSreCollaborationMessage).not.toHaveBeenCalled();
  });

  it("claims and processes Teams message events", async () => {
    const payload = {
      type: "message",
      id: "teams-message-1",
      text: "ack 018f0000-0000-7000-8000-000000000005",
      conversation: { id: "teams-conversation-1" },
      from: { id: "teams-user-1", name: "Responder" },
    };

    const response = await POST(
      new Request("http://localhost/api/webhooks/teams", {
        method: "POST",
        body: JSON.stringify(payload),
      })
    );

    expect(response.status).toBe(200);
    expect(mockClaimSreCollaborationWebhook).toHaveBeenCalledWith("teams-message-1", "teams.outgoing_webhook");
    expect(mockProcessSreCollaborationMessage).toHaveBeenCalledWith({
      provider: "teams",
      deliveryId: "teams-message-1",
      text: "ack 018f0000-0000-7000-8000-000000000005",
      channelId: "teams-conversation-1",
      threadTs: "teams-message-1",
      responderId: "teams-user-1",
      responderName: "Responder",
    });
    expect(mockUpdateSreCollaborationWebhookResult).toHaveBeenCalledWith({
      deliveryId: "teams-message-1",
      eventType: "teams.outgoing_webhook",
      status: "success",
      message: "acknowledged",
    });
  });
});
