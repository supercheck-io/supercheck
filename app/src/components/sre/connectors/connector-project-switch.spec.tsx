import { fireEvent, render, screen } from "@testing-library/react";

import { ConnectorProjectSwitch } from "./connector-project-switch";

const switchProject = jest.fn();
let mockProjects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
];
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContextSafe: () => ({
    currentProject: { id: "p1", name: "Alpha" },
    projects: mockProjects,
    switchProject,
  }),
}));

it("switches to another project", async () => {
  render(<ConnectorProjectSwitch />);

  fireEvent.keyDown(screen.getByRole("button", { name: /switch project/i }), { key: "Enter", code: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Beta" }));
  expect(switchProject).toHaveBeenCalledWith("p2", "/org-admin?tab=integrations");
});

it("hides the switch control when there is one project", () => {
  mockProjects = [{ id: "p1", name: "Alpha" }];
  render(<ConnectorProjectSwitch />);
  expect(screen.queryByRole("button", { name: /switch project/i })).not.toBeInTheDocument();
});
