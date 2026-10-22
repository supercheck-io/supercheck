import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingOrganizationSelector } from "./onboarding-organization-selector";
import { useOrganizations } from "@/hooks/use-organizations";
import { reloadProjectContext, announceProjectChange } from "@/lib/project-navigation";

jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: jest.fn() }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({ reloadProjectContext: jest.fn(), announceProjectChange: jest.fn() }));
const organizations = [
  { id: "home", name: "My organization", isActive: true },
  { id: "empty-team", name: "Team without projects", isActive: false },
];
beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", "/subscribe");
  (useOrganizations as jest.Mock).mockReturnValue({ data: organizations, activeOrganization: organizations[0] });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});
it("selects an organization without an active project", async () => {
  render(<OnboardingOrganizationSelector />);
  const select = screen.getByRole("combobox", { name: "Organization" });
  expect(screen.getByRole("option", { name: "Team without projects" })).toBeInTheDocument();
  fireEvent.change(select, { target: { value: "empty-team" } });
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/organizations/switch", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId: "empty-team" }),
  }));
  await waitFor(() => expect(reloadProjectContext).toHaveBeenCalledTimes(1));
  expect(reloadProjectContext).toHaveBeenCalledWith(expect.any(Function), "/subscribe");
  expect(announceProjectChange).toHaveBeenCalledTimes(1);
});
it("keeps the existing context when selection is rejected", async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: "Access denied" }) });
  render(<OnboardingOrganizationSelector />);
  fireEvent.change(screen.getByRole("combobox", { name: "Organization" }), { target: { value: "empty-team" } });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Access denied"));
  expect(reloadProjectContext).not.toHaveBeenCalled();
  expect(announceProjectChange).not.toHaveBeenCalled();
});
it("hides the switcher for a single organization", () => {
  (useOrganizations as jest.Mock).mockReturnValue({ data: organizations.slice(0, 1), activeOrganization: organizations[0] });
  render(<OnboardingOrganizationSelector />);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
