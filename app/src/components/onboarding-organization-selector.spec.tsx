import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingOrganizationSelector } from "./onboarding-organization-selector";
import { useProjectContext } from "@/hooks/use-project-context";
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: jest.fn(),
}));
const projects = [
  {
    id: "team",
    organizationId: "invited",
    name: "Default",
    organizationName: "Invited team",
  },
  {
    id: "team2",
    organizationId: "invited",
    name: "Other",
    organizationName: "Invited team",
  },
  {
    id: "home",
    organizationId: "own",
    name: "Default",
    organizationName: "My organization",
  },
];
it("shows each organization once and preserves switching out of an invited team", async () => {
  const switchProject = jest.fn().mockResolvedValue(true);
  (useProjectContext as jest.Mock).mockReturnValue({
    currentProject: projects[1],
    switchProject,
    projects,
  });
  render(<OnboardingOrganizationSelector />);
  const select = screen.getByRole("combobox", { name: "Organization" });
  expect(select).toHaveValue("invited");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.queryByText("Default")).not.toBeInTheDocument();
  fireEvent.change(select, { target: { value: "own" } });
  await waitFor(() => expect(switchProject).toHaveBeenCalledWith("home"));
  await waitFor(() => expect(select).not.toBeDisabled());
});
it("hides the switcher when all projects belong to one organization", () => {
  (useProjectContext as jest.Mock).mockReturnValue({
    currentProject: projects[0],
    projects: projects.slice(0, 2),
  });
  render(<OnboardingOrganizationSelector />);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
