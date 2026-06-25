import { getSreEvalFixture } from "./fixtures";
import { createSreInvestigationApiEvalRunner } from "./api-runner";

describe("SRE investigation API eval runner", () => {
  it("posts fixture incident requests and extracts a scoreable agent result", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          summary:
            "Root cause: checkout latency correlates with Kubernetes restart evidence. " +
            "Prometheus confirms the latency spike. Citations: ev-prometheus-latency-spike, ev-kubernetes-checkout-restarts.",
          toolCalls: [
            { toolName: "listIncidentConnectors", callId: "call-1" },
            { toolName: "searchLiveConnectorEvidence", callId: "call-2" },
            "telemetryInvestigator",
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const fixture = getSreEvalFixture("connector-investigation-prometheus-kubernetes-restarts");
    const runner = createSreInvestigationApiEvalRunner({
      baseUrl: "https://supercheck.test",
      headers: { authorization: "Bearer test-token" },
      fetchImpl,
      buildRequest: () => ({ incidentId: "018f0000-0000-7000-8000-000000000001" }),
    });

    const result = await runner(fixture);

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://supercheck.test/api/sre/investigate"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-token" }),
        body: JSON.stringify({
          incidentId: "018f0000-0000-7000-8000-000000000001",
          useLiveConnectors: true,
        }),
      })
    );
    expect(result.evidenceIds).toEqual(["ev-prometheus-latency-spike", "ev-kubernetes-checkout-restarts"]);
    expect(result.toolCalls).toEqual([
      { name: "listIncidentConnectors", callId: "call-1" },
      { name: "searchLiveConnectorEvidence", callId: "call-2" },
      { name: "telemetryInvestigator" },
    ]);
  });

  it("throws a useful error when the investigation API fails", async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(JSON.stringify({ error: "SRE investigation agent is not enabled" }), { status: 404 })
    );
    const fixture = getSreEvalFixture("native-evidence-monitor-timeout");
    const runner = createSreInvestigationApiEvalRunner({
      baseUrl: "https://supercheck.test",
      fetchImpl,
      buildRequest: () => ({ incidentId: "018f0000-0000-7000-8000-000000000001" }),
    });

    await expect(runner(fixture)).rejects.toThrow(
      "SRE investigation API eval failed for native-evidence-monitor-timeout: 404 SRE investigation agent is not enabled"
    );
  });
});
