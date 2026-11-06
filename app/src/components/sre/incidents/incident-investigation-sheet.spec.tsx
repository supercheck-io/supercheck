import { render, screen } from "@testing-library/react";

import { IncidentInvestigationSheet } from "./incident-investigation-sheet";

describe("IncidentInvestigationSheet", () => {
  it("renders one report body with no tabs when open", () => {
    render(
      <IncidentInvestigationSheet open onOpenChange={jest.fn()}>
        <p>report body</p>
      </IncidentInvestigationSheet>,
    );
    expect(screen.getByRole("dialog", { name: "Investigation" })).toBeInTheDocument();
    expect(screen.getByText("report body")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("renders nothing when closed", () => {
    render(
      <IncidentInvestigationSheet open={false} onOpenChange={jest.fn()}>
        <p>report body</p>
      </IncidentInvestigationSheet>,
    );
    expect(screen.queryByText("report body")).toBeNull();
  });
});
