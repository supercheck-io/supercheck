import { fireEvent, render, screen } from "@testing-library/react";

import { SreSetupGuideDialog } from "./sre-setup-guide-dialog";

describe("SreSetupGuideDialog", () => {
  it("opens an explicit setup guide without launching an add dialog", () => {
    render(
      <SreSetupGuideDialog
        status={{
          services: 1,
          connectors: 0,
          diagnosticRecipes: 0,
          privateAgents: 0,
          completedRequiredSteps: 1,
          requiredSteps: 2,
          complete: false,
        }}
      />,
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /setup guide/i }));

    expect(
      screen.getByRole("dialog", { name: "AI SRE setup" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1/2 complete")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open Integrations" }),
    ).toHaveAttribute("href", "/org-admin?tab=integrations");
    expect(
      screen.queryByRole("dialog", { name: "Add connector" }),
    ).not.toBeInTheDocument();
  });

  it("completes setup without optional saved queries", () => {
    render(
      <SreSetupGuideDialog
        status={{
          services: 1,
          connectors: 1,
          diagnosticRecipes: 0,
          privateAgents: 0,
          completedRequiredSteps: 2,
          requiredSteps: 2,
          complete: true,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /setup guide/i }));
    expect(screen.getByText("2/2 complete")).toBeInTheDocument();
    expect(screen.getByText("Save a query (optional)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Saved queries" })).toHaveAttribute("href", "/org-admin?tab=integrations&section=saved-queries");
  });
});
