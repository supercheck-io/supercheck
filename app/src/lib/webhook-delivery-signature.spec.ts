/** @jest-environment node */
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({
  fetchPublicEndpoint: jest.fn(),
}));
import {
  generateWebhookSignature,
  verifyWebhookSignature,
} from "./webhook-delivery.service";
import { formatSlackMessage } from "./slack-delivery.service";
it("rejects malformed signatures without throwing and accepts a valid signature", () => {
  expect(verifyWebhookSignature("body", "short", "secret")).toBe(false);
  expect(verifyWebhookSignature("body", "z".repeat(64), "secret")).toBe(false);
  expect(
    verifyWebhookSignature(
      "body",
      generateWebhookSignature("body", "secret"),
      "secret",
    ),
  ).toBe(true);
});
it("includes the update identity on the Slack wire payload", () => {
  expect(
    JSON.stringify(
      formatSlackMessage({
        type: "incident.updated",
        timestamp: new Date().toISOString(),
        incident_update_id: "update-id",
        statusPageId: "page",
        statusPageName: "Status",
        statusPageUrl: "https://status.example.com",
        incident: {
          id: "incident",
          name: "API",
          body: "Recovered",
          status: "resolved",
          impact: "minor",
        },
      }),
    ),
  ).toContain("update-id");
});
