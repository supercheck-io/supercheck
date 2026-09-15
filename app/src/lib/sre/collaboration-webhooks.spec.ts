/** @jest-environment node */

import { detectSreCollaborationCommand, extractSreIncidentIdFromText, sanitizeCollaborationText } from "./collaboration-webhooks";

describe("SRE collaboration webhook helpers", () => {
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
