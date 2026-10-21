import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LeaveOrganizationDialog } from "./leave-organization-dialog";
import { useOrganizations } from "@/hooks/use-organizations";
import { clearProjectsCache } from "@/hooks/use-project-context";
import { announceProjectChange, reloadProjectContext } from "@/lib/project-navigation";
import { toast } from "sonner";

jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: jest.fn() }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
jest.mock("@/lib/project-navigation", () => ({ announceProjectChange: jest.fn(), reloadProjectContext: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/components/ui/dropdown-menu", () => ({ DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: (event: React.MouseEvent) => void }) => <button onClick={onSelect}>{children}</button> }));
beforeEach(() => {
  jest.clearAllMocks();
  (useOrganizations as jest.Mock).mockReturnValue({ activeOrganization: { id: "org-1", name: "Invited team", role: "project_viewer" } });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
});
it("requires confirmation and reloads with cleared context after leaving", async () => {
  render(<LeaveOrganizationDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("Leave Invited team?")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave organization" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/organizations/leave", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: "org-1" }) }));
  await waitFor(() => expect(reloadProjectContext).toHaveBeenCalledWith(clearProjectsCache));
  expect(announceProjectChange).toHaveBeenCalledTimes(1);
});
it("lets a member cancel without changing membership", () => {
  render(<LeaveOrganizationDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(fetch).not.toHaveBeenCalled();
});
it("shows ownership guidance without a destructive action for an owner", () => {
  (useOrganizations as jest.Mock).mockReturnValue({ activeOrganization: { id: "org-1", name: "My team", role: "org_owner" } });
  render(<LeaveOrganizationDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText(/must transfer ownership or delete/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Leave organization" })).not.toBeInTheDocument();
});
it("keeps the dialog and displays a server error without reloading", async () => {
  (fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({ error: "Membership changed; try again" }) });
  render(<LeaveOrganizationDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Leave organization" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Membership changed; try again"));
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  expect(reloadProjectContext).not.toHaveBeenCalled();
});
it("keeps the confirmed organization fixed if active organization data changes", async () => {
  const { rerender } = render(<LeaveOrganizationDialog />);
  fireEvent.click(screen.getByRole("button", { name: "Leave organization" }));
  (useOrganizations as jest.Mock).mockReturnValue({ activeOrganization: { id: "org-2", name: "Other team", role: "project_viewer" } });
  rerender(<LeaveOrganizationDialog />);
  const dialog = screen.getByRole("alertdialog");
  expect(within(dialog).getByText("Leave Invited team?")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave organization" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/organizations/leave", expect.objectContaining({ body: JSON.stringify({ organizationId: "org-1" }) })));
});
