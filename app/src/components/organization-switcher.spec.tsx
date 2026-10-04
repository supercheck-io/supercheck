import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mockOrganizations = jest.fn();
const mockRefetch = jest.fn();
jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: () => mockOrganizations() }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ isCloudHosted: true, isDemoMode: false }) }));
jest.mock("@/lib/organization-navigation", () => ({ reloadOrganization: jest.fn() }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
// Exercise mutation behavior independently of the dropdown library's pointer handling.
jest.mock("@/components/ui/dropdown-menu", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { DropdownMenu: Container, DropdownMenuContent: Container, DropdownMenuLabel: Container,
    DropdownMenuTrigger: Container, DropdownMenuSeparator: () => null,
    DropdownMenuItem: ({ children, onSelect, disabled }: { children: ReactNode; onSelect: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onSelect}>{children}</button> };
});

import { OrganizationSwitcher } from "./organization-switcher";
import { reloadOrganization } from "@/lib/organization-navigation";
import { toast } from "sonner";

describe("organization selection and creation", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    const organizations = [
      { id: "org-a", name: "Paid team", subscriptionPlan: "plus", isActive: false },
      { id: "org-b", name: "New team", subscriptionPlan: null, isActive: true },
    ];
    mockOrganizations.mockReturnValue({ data: organizations, activeOrganization: organizations[1], isPending: false, isError: false, refetch: mockRefetch });
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    global.fetch = fetchMock;
  });
  afterEach(() => { global.fetch = originalFetch; });

  it("lets a user leave an unpaid organization for their paid organization", async () => {
    render(<OrganizationSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Paid team/ }));
    await waitFor(() => expect(reloadOrganization).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith("/api/organizations/switch", expect.objectContaining({ body: JSON.stringify({ organizationId: "org-a" }) }));
  });

  it("creates with only the organization name and explains independent subscriptions", async () => {
    render(<OrganizationSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(screen.getByText(/Creating an organization does not start a subscription/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "  Another team  " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create organization" }).at(-1)!);
    await waitFor(() => expect(reloadOrganization).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/organizations", expect.objectContaining({ body: JSON.stringify({ name: "Another team" }) }));
  });

  it("keeps the selected organization when the switch fails and allows retry", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Access denied" }) });
    render(<OrganizationSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Paid team/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Access denied"));
    expect(reloadOrganization).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Paid team/ }));
    await waitFor(() => expect(reloadOrganization).toHaveBeenCalledTimes(1));
  });

  it("offers a retry when organization loading fails", () => {
    mockOrganizations.mockReturnValue({ isError: true, refetch: mockRefetch });
    render(<OrganizationSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Retry organizations" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});
