import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let mockMcpEnabled = false;
const mockUpdateUser = jest.fn();
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ isMcpEnabled: mockMcpEnabled }) }));
jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({ data: { user: { name: "Ada", email: "ada@example.com", image: null } } }),
  authClient: { updateUser: (...a: unknown[]) => mockUpdateUser(...a), $store: { notify: jest.fn() } },
}));
jest.mock("@/components/connected-apps/connected-apps", () => ({ ConnectedApps: () => <div>apps list</div> }));
jest.mock("@/components/leave-organization-dialog", () => ({ LeaveOrganizationDialog: () => <div>leave organization row</div> }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { AccountDialog } from "./account-dialog";

describe("AccountDialog", () => {
  beforeEach(() => {
    mockMcpEnabled = false;
    mockUpdateUser.mockReset().mockResolvedValue({ error: null });
  });

  it("renders the profile with a read-only email", () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByLabelText("Name")).toHaveValue("Ada");
    expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    expect(screen.getByText("leave organization row")).toBeInTheDocument();
  });

  it("always offers the source code link", () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("link", { name: "Source code" })).toHaveAttribute("target", "_blank");
  });

  it("validates the name and saves it trimmed", async () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    const input = screen.getByLabelText("Name");
    fireEvent.change(input, { target: { value: "   " } });
    expect(screen.getByRole("alert")).toHaveTextContent("Name is required");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "x".repeat(101) } });
    expect(screen.getByRole("alert")).toHaveTextContent("100 characters");
    fireEvent.change(input, { target: { value: "  Grace  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ name: "Grace" }));
  });

  it("hides Connected apps when MCP is disabled", () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.queryByText("Connected apps")).not.toBeInTheDocument();
  });

  it("shows Connected apps as a tab when MCP is enabled", () => {
    mockMcpEnabled = true;
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("tab", { name: "Connected apps" })).toBeInTheDocument();
  });
});
