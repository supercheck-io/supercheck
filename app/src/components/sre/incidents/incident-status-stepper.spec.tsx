import { render, screen } from "@testing-library/react";

import { IncidentStatusStepper } from "./incident-status-stepper";

describe("IncidentStatusStepper", () => {
  it("marks only the current status as the current step and earlier ones done", () => {
    render(<IncidentStatusStepper current="investigating" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(6);
    expect(items.filter((item) => item.getAttribute("aria-current") === "step")).toHaveLength(1);
    expect(screen.getByText("Investigating").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/^Triggered/).closest("li")).toHaveAttribute("data-state", "done");
    expect(screen.getByText("Monitoring").closest("li")).toHaveAttribute("data-state", "upcoming");
  });

  it("marks every step done when resolved", () => {
    render(<IncidentStatusStepper current="resolved" />);
    expect(screen.getAllByRole("listitem").every((item) => item.getAttribute("data-state") !== "upcoming")).toBe(true);
  });
});
