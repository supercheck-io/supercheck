/** @jest-environment node */
jest.mock("@/lib/sre/connectors/pinned-fetch", () => ({
  fetchPublicEndpoint: jest.fn(),
}));

import { fetchPublicEndpoint } from "@/lib/sre/connectors/pinned-fetch";
import { sendWebhookVerificationChallenge } from "./webhook-delivery.service";

const endpoint = "https://hooks.example.com/supercheck";
const event = {
  type: "supercheck.webhook.verification" as const,
  token: "challenge-token",
  statusPageId: "page-id",
  createdAt: "2026-10-20T00:00:00.000Z",
};

beforeEach(() => jest.clearAllMocks());

it("accepts a 2xx response echoing the token in the verification header", async () => {
  jest.mocked(fetchPublicEndpoint).mockResolvedValue(
    new Response(null, {
      status: 204,
      headers: { "x-supercheck-verification": event.token },
    }),
  );
  await expect(
    sendWebhookVerificationChallenge(endpoint, event),
  ).resolves.toMatchObject({ success: true, statusCode: 204 });
  expect(fetchPublicEndpoint).toHaveBeenCalledWith(
    endpoint,
    expect.objectContaining({ method: "POST", body: JSON.stringify(event) }),
    4096,
  );
});

it("accepts a JSON challenge field", async () => {
  jest.mocked(fetchPublicEndpoint).mockResolvedValue(
    Response.json({ challenge: event.token }),
  );
  await expect(
    sendWebhookVerificationChallenge(endpoint, event),
  ).resolves.toMatchObject({ success: true });
});

it("rejects a 2xx response that does not echo the token", async () => {
  jest.mocked(fetchPublicEndpoint).mockResolvedValue(
    Response.json({ challenge: "someone-elses-token" }),
  );
  const result = await sendWebhookVerificationChallenge(endpoint, event);
  expect(result.success).toBe(false);
  expect(result.error).toMatch(/did not echo/i);
});

it("rejects a non-2xx response", async () => {
  jest
    .mocked(fetchPublicEndpoint)
    .mockResolvedValue(new Response("nope", { status: 500 }));
  await expect(
    sendWebhookVerificationChallenge(endpoint, event),
  ).resolves.toMatchObject({ success: false, statusCode: 500 });
});

it("reports a timeout without throwing", async () => {
  jest
    .mocked(fetchPublicEndpoint)
    .mockRejectedValue(new Error("The operation was aborted due to timeout"));
  await expect(
    sendWebhookVerificationChallenge(endpoint, event),
  ).resolves.toMatchObject({ success: false, error: expect.stringMatching(/timeout/i) });
});

it("rejects unsafe endpoints before making a request", async () => {
  await expect(
    sendWebhookVerificationChallenge("http://127.0.0.1/hook", event),
  ).resolves.toMatchObject({ success: false });
  expect(fetchPublicEndpoint).not.toHaveBeenCalled();
});
