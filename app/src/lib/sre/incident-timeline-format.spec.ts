import { parsePostmortemTimeline } from "./incident-timeline-format";

describe("parsePostmortemTimeline", () => {
  it("reads draft lines as moments and maps known titles back to their events", () => {
    const moments = parsePostmortemTimeline(
      [
        "- 4 Sep 2026, 05:46 UTC: AI investigation: Latency rose after **deploy 42**.",
        "- 13 Sep 2026, 16:34 UTC: AI triage failed: model timeout",
        "",
        "- 7 Nov 2026, 05:00 UTC: Acknowledged",
        "* 7 Nov 2026, 05:01 UTC: **Incident created**: by hand",
        "- 7 Nov 2026, 05:02 UTC: Rolled back the canary",
      ].join("\n"),
    );
    expect(moments).toEqual([
      { date: "4 Sep 2026", time: "05:46", title: "AI investigation", detail: "Latency rose after **deploy 42**.", event: { eventType: "ai_finding", eventData: { type: "sre_investigation" } } },
      // The longer title wins over its prefix "AI triage".
      { date: "13 Sep 2026", time: "16:34", title: "AI triage failed", detail: "model timeout", event: { eventType: "state_change", eventData: { state: "triage_failed" } } },
      { date: "7 Nov 2026", time: "05:00", title: "Acknowledged", detail: "", event: { eventType: "state_change", eventData: { state: "acknowledged" } } },
      { date: "7 Nov 2026", time: "05:01", title: "Incident created", detail: "by hand", event: { eventType: "state_change", eventData: { state: "manual_incident_created" } } },
      // An unknown title is kept as plain text.
      { date: "7 Nov 2026", time: "05:02", title: null, detail: "Rolled back the canary", event: null },
    ]);
  });

  it("returns null when any line has another shape, or there is nothing", () => {
    expect(parsePostmortemTimeline("- 4 Sep 2026, 05:46 UTC: Resolved\nThe team rolled back.")).toBeNull();
    expect(parsePostmortemTimeline("- yesterday around noon: Resolved")).toBeNull();
    expect(parsePostmortemTimeline("  \n ")).toBeNull();
    expect(parsePostmortemTimeline("- 6 Oct 2026, 14:58 UTC:   ")).toBeNull();
  });

  it("reads ISO timestamps with a dash separator and infers the icon from the sentence", () => {
    const moments = parsePostmortemTimeline(
      [
        "- 2026-10-26T23:49:24Z \u2014 Incident created from alert history.",
        "- 2026-10-26T23:57:24Z \u2014 Incident acknowledged.",
        "- 2026-11-06T09:31:08Z \u2014 An AI finding recorded the assessment as inconclusive.",
        "- 2026-11-06T09:31:15Z - Incident resolved; cause remained undetermined.",
        "- 2026-11-06 09:40 UTC: Rolled back the canary",
      ].join("\n"),
    );
    expect(moments?.map((m) => [m.date, m.time, m.event?.eventData])).toEqual([
      ["26 Oct 2026", "23:49", { state: "manual_incident_created" }],
      ["26 Oct 2026", "23:57", { state: "acknowledged" }],
      ["6 Nov 2026", "09:31", { type: "sre_investigation" }],
      ["6 Nov 2026", "09:31", { state: "resolved" }],
      ["6 Nov 2026", "09:40", undefined],
    ]);
    expect(moments?.[0]?.detail).toBe("Incident created from alert history.");
  });

  it("rejects an impossible month", () => {
    expect(parsePostmortemTimeline("- 2026-13-01T10:00:00Z \u2014 Resolved")).toBeNull();
  });
});
