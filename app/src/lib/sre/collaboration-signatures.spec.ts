/** @jest-environment node */

import { createHmac } from "crypto";

import { verifySlackRequestSignature, verifyTeamsOutgoingWebhookSignature } from "./collaboration-signatures";

describe("SRE collaboration signature verification", () => {
  it("verifies Slack signatures over the raw request body", () => {
    const body = JSON.stringify({ type: "event_callback", event_id: "Ev1" });
    const timestamp = "1710000000";
    const secret = "slack-signing-secret";
    const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

    expect(
      verifySlackRequestSignature({
        body,
        timestamp,
        signature,
        signingSecret: secret,
        now: new Date(Number(timestamp) * 1000),
      })
    ).toBe(true);
  });

  it("rejects stale Slack timestamps before body processing", () => {
    const body = "{}";
    const timestamp = "1710000000";
    const secret = "slack-signing-secret";
    const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;

    expect(
      verifySlackRequestSignature({
        body,
        timestamp,
        signature,
        signingSecret: secret,
        now: new Date((Number(timestamp) + 600) * 1000),
      })
    ).toBe(false);
  });

  it("verifies Teams outgoing webhook HMAC signatures", () => {
    const body = JSON.stringify({ type: "message", text: "investigate" });
    const secret = "teams-shared-secret";
    const authorization = `HMAC ${createHmac("sha256", secret).update(body).digest("base64")}`;

    expect(
      verifyTeamsOutgoingWebhookSignature({
        body,
        authorization,
        sharedSecret: secret,
      })
    ).toBe(true);
  });
});
