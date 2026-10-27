import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { McpToolsDialog } from "./mcp-tools-dialog";

const mockGet = jest.fn();
const mockDiscover = jest.fn();
const mockSave = jest.fn();
jest.mock("@/actions/sre-mcp-connectors", () => ({
  getSreMcpToolState: (...a: unknown[]) => mockGet(...a),
  discoverSreMcpTools: (...a: unknown[]) => mockDiscover(...a),
  saveSreMcpToolAllowlist: (...a: unknown[]) => mockSave(...a),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const connector = { id: "c1", name: "Internal MCP" } as never;
const schema = { type: "object", properties: {} };
const state = (over: Record<string, unknown> = {}) => ({
  discoveredAt: null,
  discovered: [
    { name: "get_errors", description: "Read errors", inputSchema: schema, unsupportedReason: null, readOnlyHint: true },
    { name: "wild", description: "", inputSchema: null, unsupportedReason: "unsupported keyword oneOf" },
  ],
  allowlist: [],
  ...over,
});

describe("McpToolsDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGet.mockResolvedValue({ success: true, state: state(), message: "" });
  });

  it("shows hints without granting access and blocks unsupported tools", async () => {
    render(<McpToolsDialog connector={connector} open onOpenChange={jest.fn()} />);
    expect(await screen.findByText("Server says read-only")).toBeInTheDocument();
    expect(screen.getByLabelText("Allow wild")).toBeDisabled();
    expect(screen.getByLabelText("Allow get_errors")).not.toBeChecked();
  });

  it("saves only the ticked tools", async () => {
    mockSave.mockResolvedValue({ success: true, state: state(), message: "1 tool(s) allowlisted" });
    render(<McpToolsDialog connector={connector} open onOpenChange={jest.fn()} />);
    fireEvent.click(await screen.findByLabelText("Allow get_errors"));
    fireEvent.click(screen.getByRole("button", { name: "Save allowlist" }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith({
        id: "c1",
        tools: [{ name: "get_errors", fixedArguments: {} }],
      }),
    );
  });

  it("drops ticks for tools that vanish or become unsupported after re-discovery", async () => {
    mockGet.mockResolvedValue({
      success: true,
      state: state({ allowlist: [{ name: "get_errors", description: "", fixedArguments: {} }, { name: "gone", description: "", fixedArguments: {} }] }),
      message: "",
    });
    mockDiscover.mockResolvedValue({
      success: true,
      state: state({
        discovered: [{ name: "get_errors", description: "", inputSchema: null, unsupportedReason: "unsupported keyword oneOf" }],
      }),
      message: "Discovered",
    });
    mockSave.mockResolvedValue({ success: true, state: state(), message: "ok" });
    render(<McpToolsDialog connector={connector} open onOpenChange={jest.fn()} />);
    await screen.findByLabelText("Allow get_errors");
    fireEvent.click(screen.getByRole("button", { name: /Discover tools/ }));
    await waitFor(() => expect(mockDiscover).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save allowlist" })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(screen.queryByLabelText("Allow wild")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save allowlist" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith({ id: "c1", tools: [] }));
  });

  it("rejects malformed fixed arguments before saving", async () => {
    render(<McpToolsDialog connector={connector} open onOpenChange={jest.fn()} />);
    fireEvent.click(await screen.findByLabelText("Allow get_errors"));
    fireEvent.change(screen.getByLabelText("Fixed arguments for get_errors"), { target: { value: "[1]" } });
    fireEvent.click(screen.getByRole("button", { name: "Save allowlist" }));
    await waitFor(() => expect(mockSave).not.toHaveBeenCalled());
  });
});
