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
import { AVATAR_PRESETS, defaultAvatarFor } from "@/lib/avatar-presets";

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
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove photo" })).not.toBeInTheDocument();
    expect(screen.getByText("leave organization row")).toBeInTheDocument();
  });

  it("has no license footer (the source link lives in the community links)", () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.queryByText(/open source/i)).not.toBeInTheDocument();
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

  it("keeps Save off until something changes, and shows the default preset as selected", () => {
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(AVATAR_PRESETS.length);
    const index = AVATAR_PRESETS.indexOf(defaultAvatarFor("Ada"));
    expect(screen.getByRole("radio", { name: `Avatar ${index + 1}` })).toHaveAttribute("aria-checked", "true");
  });

  it("stages a preset and saves it with the name in one Save", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    const onOpenChange = jest.fn();
    render(<AccountDialog open onOpenChange={onOpenChange} />);
    const other = AVATAR_PRESETS.find((p) => p !== defaultAvatarFor("Ada"))!;
    fireEvent.click(screen.getByRole("radio", { name: `Avatar ${AVATAR_PRESETS.indexOf(other) + 1}` }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Grace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(fetchMock).toHaveBeenCalledWith("/api/users/me/avatar", expect.objectContaining({ method: "PUT", body: JSON.stringify({ preset: other }) }));
    expect(mockUpdateUser).toHaveBeenCalledWith({ name: "Grace" });
  });

  it("saves the shown default when picked, so a later rename keeps it", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<AccountDialog open onOpenChange={jest.fn()} />);
    const shown = defaultAvatarFor("Ada");
    fireEvent.click(screen.getByRole("radio", { name: `Avatar ${AVATAR_PRESETS.indexOf(shown) + 1}` }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/users/me/avatar", expect.objectContaining({ body: JSON.stringify({ preset: shown }) })));
    expect(mockUpdateUser).not.toHaveBeenCalled();
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
