import { render, screen } from "@testing-library/react";
import { FileText, Sparkles } from "lucide-react";

import { IncidentInvestigationSheet } from "./incident-investigation-sheet";

const tabs = [
  { id: "analysis", title: "Analysis", icon: Sparkles, content: <p>analysis body</p> },
  { id: "postmortem", title: "Post-mortem", icon: FileText, content: null },
];

describe("IncidentInvestigationSheet", () => {
  it("leaves out empty tabs and falls back to the first tab when the requested one is missing", () => {
    render(<IncidentInvestigationSheet open onOpenChange={jest.fn()} tabs={tabs} tab="postmortem" onTabChange={jest.fn()} />);
    expect(screen.queryByRole("tab", { name: "Post-mortem" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Analysis" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("analysis body")).toBeInTheDocument();
  });
});
