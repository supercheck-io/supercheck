import { render, screen } from "@testing-library/react";

import { extractSreVerificationTasks, SreVerificationPanel } from "./verification-panel";

describe("SRE verification panel", () => {
  it("extracts bounded sanitized verification tasks", () => {
    const tasks = extractSreVerificationTasks([
      "Summary without keyword",
      "Finding cites ev-monitor-timeout.",
      "- Verify Prometheus error rate returns to baseline with token=secret-value",
      "2. Confirm Kubernetes restarts stop after the human fix",
      "Monitor checkout latency for 30 minutes",
      "Check dashboards for payment dependency saturation",
      "Validate synthetic monitor recovery",
      "Observe queue depth",
    ].join("\n"));

    expect(tasks).toEqual([
      "Verify Prometheus error rate returns to baseline with token=[REDACTED]",
      "Confirm Kubernetes restarts stop after the human fix",
      "Monitor checkout latency for 30 minutes",
      "Check dashboards for payment dependency saturation",
      "Validate synthetic monitor recovery",
    ]);
  });

  it("renders readiness and suggested checks", () => {
    render(
      <SreVerificationPanel
        evidenceCount={2}
        hasPrimaryService={true}
        useLiveConnectors={true}
        latestAssistantContent="Verification plan:\n- Verify ev-monitor-timeout recovered\n- Confirm no new restarts"
      />
    );

    expect(screen.getByText("Verification readiness")).toBeInTheDocument();
    expect(screen.getByText("2 stored evidence items available for citation checks.")).toBeInTheDocument();
    expect(screen.getByText("Verify ev-monitor-timeout recovered")).toBeInTheDocument();
    expect(screen.getByText("Confirm no new restarts")).toBeInTheDocument();
  });

  it("shows attention guidance when context is incomplete", () => {
    render(
      <SreVerificationPanel
        evidenceCount={0}
        hasPrimaryService={false}
        useLiveConnectors={false}
        latestAssistantContent={null}
      />
    );

    expect(screen.getByText("Generate an evidence brief or gather connector evidence before trusting root-cause claims.")).toBeInTheDocument();
    expect(screen.getByText("Map a primary service before using live connector investigation.")).toBeInTheDocument();
    expect(screen.getByText("Ask Copilot for a verification plan after evidence is gathered. SuperCheck will not apply remediation automatically.")).toBeInTheDocument();
  });
});
