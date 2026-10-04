import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingProjectSelector } from "./onboarding-project-selector";
import { useProjectContext } from "@/hooks/use-project-context";
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: jest.fn() }));

it("lets a user leave an inaccessible invited team by selecting their own project", async () => {
  const switchProject = jest.fn().mockResolvedValue(true);
  (useProjectContext as jest.Mock).mockReturnValue({ projectId: "team", switchProject, projects: [
    { id: "team", name: "Default", organizationName: "Invited team" },
    { id: "home", name: "Default", organizationName: "My organization" },
  ] });
  render(<OnboardingProjectSelector />);
  const select = screen.getByRole("combobox", { name: "Project" });
  expect(screen.getByRole("option", { name: "Default · My organization" })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "home" } });
  await waitFor(() => expect(switchProject).toHaveBeenCalledWith("home"));
  await waitFor(() => expect(select).not.toBeDisabled());
});
