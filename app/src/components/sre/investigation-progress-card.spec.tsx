import { render, screen } from "@testing-library/react";

import { SreInvestigationProgressCard, summarizeSreAgentProgressEvent } from "./investigation-progress-card";

describe("SRE investigation progress card", () => {
  it("summarizes agent step events without exposing raw payloads", () => {
    const summary = summarizeSreAgentProgressEvent("agent.step", {
      stepIndex: 2,
      elapsedMs: 1250,
      modelId: "test-model",
      event: {
        toolCalls: [{ toolCallId: "call-1", toolName: "searchLiveConnectorEvidence", input: { token: "secret-value" } }],
        toolResults: [{
          toolCallId: "call-1",
          output: { token: "result-secret" },
          summary: {
            itemCount: 1,
            message: "Persisted 1 connector evidence item(s)",
            evidence: [{ id: "ev-prometheus-latency", title: "Latency spike", evidenceType: "metric", sourceType: "prometheus" }],
          },
        }],
      },
    });

    expect(summary).toEqual({
      kind: "step",
      title: "Agent step 2",
      description: "1 read-only tool call · model: test-model",
      status: "running",
      elapsedMs: 1250,
      tools: [{
        id: "call-1",
        name: "searchLiveConnectorEvidence",
        status: "completed",
        summary: {
          itemCount: 1,
          message: "Persisted 1 connector evidence item(s)",
          privateAgentJobId: null,
          evidence: [{ id: "ev-prometheus-latency", title: "Latency spike", evidenceType: "metric", sourceType: "prometheus" }],
          connectors: [],
        },
      }],
    });
    expect(JSON.stringify(summary)).not.toContain("secret-value");
    expect(JSON.stringify(summary)).not.toContain("result-secret");
  });

  it("falls back to safe tool labels for unexpected names", () => {
    const summary = summarizeSreAgentProgressEvent("agent.step", {
      event: {
        toolCalls: [{ toolCallId: "call-2", toolName: "unsafe tool with spaces", input: { token: "secret-value" } }],
      },
    });

    expect(summary?.tools).toEqual([{ id: "call-2", name: "read-only tool", status: "called" }]);
  });

  it("renders recent progress events", () => {
    render(
      <SreInvestigationProgressCard
        events={[
          {
            id: "event-1",
            kind: "step",
            title: "Agent step 1",
            description: "model reasoning step",
            status: "running",
            elapsedMs: 500,
            tools: [{
              id: "call-1",
              name: "listNativeEvidence",
              status: "completed",
              summary: {
                itemCount: 1,
                message: "Returned stored evidence",
                evidence: [{ id: "ev-monitor-timeout", title: "Monitor timeout", evidenceType: "event", sourceType: "native" }],
              },
            }],
          },
          {
            id: "event-2",
            kind: "done",
            title: "SRE AI response complete",
            status: "success",
          },
        ]}
      />
    );

    expect(screen.getByText("Investigation progress")).toBeInTheDocument();
    expect(screen.getByText("Agent step 1")).toBeInTheDocument();
    expect(screen.getByText("Read-only tool activity")).toBeInTheDocument();
    expect(screen.getByText("listNativeEvidence")).toBeInTheDocument();
    expect(screen.getByText("1 safe result item")).toBeInTheDocument();
    expect(screen.getByText("Evidence ev-monitor-timeout: Monitor timeout (event/native)")).toBeInTheDocument();
    expect(screen.getByText("SRE AI response complete")).toBeInTheDocument();
  });
});
