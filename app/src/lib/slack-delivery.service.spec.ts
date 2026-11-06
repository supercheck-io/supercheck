/** @jest-environment node */
const fetchPublicEndpoint = jest.fn();
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({ fetchPublicEndpoint: (...a: unknown[]) => fetchPublicEndpoint(...a) }));

import { deliverSlackMessage, type SlackIncidentEvent } from "./slack-delivery.service";

const event = {
  type: "incident.created", timestamp: new Date().toISOString(), statusPageId: "p", statusPageName: "P", statusPageUrl: "https://s.example.com",
  incident: { id: "i", name: "n", status: "investigating", impact: "minor", body: "b" },
} as SlackIncidentEvent;

it.each(["https://evil.slack.com/services/T/B/x", "https://files.slack.com/x", "http://hooks.slack.com/services/T/B/x"])(
  "refuses to deliver to %s, even for an existing subscriber row",
  async (url) => {
    const result = await deliverSlackMessage(url, event);
    expect(result.success).toBe(false);
    expect(fetchPublicEndpoint).not.toHaveBeenCalled();
  },
);
