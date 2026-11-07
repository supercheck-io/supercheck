import { parsePostmortemTimeline } from "./incident-timeline-format";

describe("parsePostmortemTimeline", () => {
  it("reads draft lines as moments and maps known titles back to their events", () => {
    const moments = parsePostmortemTimeline(
      [
        "- 4 Sep 2026, 05:46 UTC: AI investigation: Latency rose after **deploy 42**.",
        "- 13 Sep 2026, 16:34 UTC: AI triage failed: model timeout",
        "",
        "- 7 Nov 2026, 05:00 UTC: Acknowledged",
        "* 7 Nov 2026, 05:01 UTC: Incident created: by hand",
        "- 7 Nov 2026, 05:02 UTC: Rolled back the canary",
      ].join("\n"),
    );
    expect(moments).toEqual([
      { when: "4 Sep 2026, 05:46 UTC", title: "AI investigation", detail: "Latency rose after deploy 42.", event: { eventType: "ai_finding", eventData: { type: "sre_investigation" } } },
      // The longer title wins over its prefix "AI triage".
      { when: "13 Sep 2026, 16:34 UTC", title: "AI triage failed", detail: "model timeout", event: { eventType: "state_change", eventData: { state: "triage_failed" } } },
      { when: "7 Nov 2026, 05:00 UTC", title: "Acknowledged", detail: "", event: { eventType: "state_change", eventData: { state: "acknowledged" } } },
      { when: "7 Nov 2026, 05:01 UTC", title: "Incident created", detail: "by hand", event: { eventType: "state_change", eventData: { state: "manual_incident_created" } } },
      // An unknown title is kept as plain text.
      { when: "7 Nov 2026, 05:02 UTC", title: null, detail: "Rolled back the canary", event: null },
    ]);
  });

  it("returns null when any line has another shape, or there is nothing", () => {
    expect(parsePostmortemTimeline("- 4 Sep 2026, 05:46 UTC: Resolved\nThe team rolled back.")).toBeNull();
    expect(parsePostmortemTimeline("- 2026-09-04 05:46: Resolved")).toBeNull();
    expect(parsePostmortemTimeline("  \n ")).toBeNull();
    expect(parsePostmortemTimeline("- 6 Oct 2026, 14:58 UTC:   ")).toBeNull();
  });
});
