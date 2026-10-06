/** @jest-environment node */

import { detectSreCollaborationCommand, extractSreIncidentIdFromText, sanitizeCollaborationText, isResponderAllowed, processSreCollaborationMessage } from "./collaboration-webhooks";

describe("SRE collaboration webhook helpers", () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  it("requires an explicit responder allowlist", () => {
    delete process.env.SRE_COLLABORATION_ALLOWED_RESPONDER_IDS;
    expect(isResponderAllowed("U123")).toBe(false);
    process.env.SRE_COLLABORATION_ALLOWED_RESPONDER_IDS = " U123, U456 ";
    expect(isResponderAllowed("U123")).toBe(true);
    expect(isResponderAllowed("U999")).toBe(false);
    expect(isResponderAllowed(null)).toBe(false);
  });

  it("does not process collaboration commands when SRE is disabled", async () => {
    process.env.SRE_ENABLED = "false";
    expect(await processSreCollaborationMessage({ provider: "slack", deliveryId: "event-1", text: "ack" }))
      .toEqual({ status: "skipped", reason: "disabled" });
  });
  it("extracts an incident UUID from provider text", () => {
    expect(
      extractSreIncidentIdFromText("please investigate https://app.example.com/incidents/018f0000-0000-7000-8000-000000000005")
    ).toBe("018f0000-0000-7000-8000-000000000005");
  });

  it("detects safe internal incident commands", () => {
    expect(detectSreCollaborationCommand("ack this incident")).toBe("acknowledge");
    expect(detectSreCollaborationCommand("mark resolved 018f0000-0000-7000-8000-000000000005")).toBe("resolve");
    expect(detectSreCollaborationCommand("what is causing this latency spike?")).toBe("investigate");
  });

  it("sanitizes provider mention/link markup", () => {
    expect(sanitizeCollaborationText("<@U123> check <https://example.com|the dashboard> now")).toBe(
      "check the dashboard (https://example.com) now"
    );
  });
});
