import { render, screen } from "@testing-library/react";

import { SreInvestigationReportPanel } from "./sre-investigation-report-panel";

describe("SreInvestigationReportPanel", () => {
  it("renders a safe empty report state before assistant output exists", () => {
    render(
      <SreInvestigationReportPanel
        evidenceReferences={[]}
        latestAssistantContent={null}
        progressEvents={[]}
      />
    );

    expect(screen.getByText("Investigation report")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(screen.getByText("No working theory yet. Ask Copilot for a root-cause hypothesis after evidence has been collected.")).toBeInTheDocument();
    expect(screen.getByText("No evidence links yet. Ask Copilot to cite incident evidence IDs or run read-only connector collection.")).toBeInTheDocument();
    expect(screen.getByText("No verification actions extracted yet. SuperCheck stays read-only and does not apply remediation automatically.")).toBeInTheDocument();
  });

  it("links cited evidence, extracts verification actions, and summarizes latest activity", () => {
    render(
      <SreInvestigationReportPanel
        evidenceReferences={[
          { id: "ev-checkout-5xx", title: "Checkout 5xx spike", evidenceType: "metric" },
          { id: "ev-checkout-error-log", title: "Checkout error log", evidenceType: "log" },
        ]}
        latestAssistantContent={[
          "Likely root cause: checkout API is returning elevated 5xx after a dependency timeout, supported by ev-checkout-5xx and ev-checkout-error-log.",
          "- Verify checkout error budget recovery before closing the incident.",
          "- Confirm payment dependency latency has returned to baseline.",
          "Cited evidence: ev-missing-span",
        ].join("\n")}
        progressEvents={[
          {
            id: "progress-1",
            kind: "step",
            title: "Agent step 1",
            description: "2 read-only tool calls",
            status: "running",
          },
          {
            id: "progress-2",
            kind: "done",
            title: "Copilot response complete",
            description: "The assistant response was saved to the conversation.",
            status: "success",
          },
        ]}
      />
    );

    expect(screen.getByText("Evidence-backed draft")).toBeInTheDocument();
    expect(screen.getByText(/Likely root cause: checkout API is returning elevated 5xx/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Checkout 5xx spike evidence ev-checkout-5xx" })).toHaveAttribute(
      "href",
      "#sre-evidence-ev-checkout-5xx"
    );
    expect(screen.getByRole("link", { name: "Open Checkout error log evidence ev-checkout-error-log" })).toHaveAttribute(
      "href",
      "#sre-evidence-ev-checkout-error-log"
    );
    expect(screen.getByText("Cited but not found in stored evidence")).toBeInTheDocument();
    expect(screen.getByText("ev-missing-span")).toBeInTheDocument();
    expect(screen.getByText(/Action 1:/)).toBeInTheDocument();
    expect(screen.getByText(/Verify checkout error budget recovery before closing the incident./)).toBeInTheDocument();
    expect(screen.getByText("Copilot response complete")).toBeInTheDocument();
  });

  it("marks a streaming report as building", () => {
    render(
      <SreInvestigationReportPanel
        evidenceReferences={[]}
        latestAssistantContent={null}
        progressEvents={[{ id: "progress-1", kind: "step", title: "Agent step 1", status: "running" }]}
        isInvestigating={true}
      />
    );

    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Streaming read-only investigation steps into a draft responder report.")).toBeInTheDocument();
  });
});
