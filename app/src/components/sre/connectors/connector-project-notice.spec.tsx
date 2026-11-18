import { fireEvent, render, screen } from "@testing-library/react";

import { ConnectorProjectNotice } from "./connector-project-notice";

const switchProject = jest.fn();
let mockProjects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({
    currentProject: { id: "p1", name: "Alpha" },
    projects: mockProjects,
    switchProject,
  }),
}));

it("names the project and switches to another one", async () => {
  render(<ConnectorProjectNotice />);
  expect(screen.getByText("Alpha")).toBeInTheDocument();
  expect(screen.getByText(/AI SRE uses them to investigate incidents/)).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("button", { name: /switch project/i }), { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Beta" }));
  expect(switchProject).toHaveBeenCalledWith("p2", "/org-admin?tab=integrations");
});

it("hides the switch control when there is one project", () => {
  mockProjects = [{ id: "p1", name: "Alpha" }];
  render(<ConnectorProjectNotice />);
  expect(screen.queryByRole("button", { name: /switch project/i })).not.toBeInTheDocument();
});
