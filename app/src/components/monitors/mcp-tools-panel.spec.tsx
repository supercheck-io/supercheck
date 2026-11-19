import { fireEvent, render, screen } from "@testing-library/react";
import { McpToolsButton, McpToolsPanel } from "./mcp-tools-panel";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const baseline = (names: string[]) => ({ hash: "h", takenAt: "2026-11-01T00:00:00Z", tools: names.map((name) => ({ name, fingerprint: "f" })) });
const change = (at: string, added: string[] = [], removed: string[] = [], changed: { name: string; reasons: Array<"description" | "schema"> }[] = []) => ({ at, added, removed, changed });

describe("McpToolsPanel", () => {
  it("lists the current tools with their count", () => {
    render(<McpToolsPanel baseline={baseline(["search", "fetch"])} now={NOW} />);
    expect(screen.getByTestId("mcp-tool-count")).toHaveTextContent("2");
    expect(screen.getByTestId("mcp-tool-list")).toHaveTextContent("search");
    expect(screen.getByTestId("mcp-tool-list")).toHaveTextContent("fetch");
    expect(screen.queryByText("Changes")).not.toBeInTheDocument();
  });

  it("shows the server and protocol as muted header text when given", () => {
    const { rerender } = render(<McpToolsPanel baseline={baseline(["a"])} now={NOW} meta="lumen-freight-mcp 1.8.2 · MCP 2025-06-18" />);
    expect(screen.getByTestId("mcp-server-meta")).toHaveTextContent("lumen-freight-mcp 1.8.2 · MCP 2025-06-18");
    rerender(<McpToolsPanel baseline={baseline(["a"])} now={NOW} />);
    expect(screen.queryByTestId("mcp-server-meta")).not.toBeInTheDocument();
  });

  it("shows changes newest first and expands one to names and reasons", () => {
    render(
      <McpToolsPanel
        baseline={baseline(["a"])}
        now={NOW}
        changes={[
          change("2026-11-01T10:00:00Z", ["old_tool"]),
          change("2026-11-13T10:00:00Z", ["x", "y"], ["z"], [{ name: "q", reasons: ["description", "schema"] }]),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("mcp-change");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("+2 added, -1 removed, ~1 changed");
    expect(rows[1]).toHaveTextContent("+1 added");
    expect(screen.queryByTestId("mcp-change-detail")).not.toBeInTheDocument();
    const toggle = rows[0].querySelector("button") as HTMLButtonElement;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = screen.getByTestId("mcp-change-detail");
    expect(detail).toHaveTextContent("x");
    expect(detail).toHaveTextContent("z");
    expect(detail).toHaveTextContent("description and input schema");
  });

  it("shows the Tools changed badge only when the newest change is under 24 hours old", () => {
    const { rerender } = render(<McpToolsPanel baseline={baseline(["a"])} now={NOW} changes={[change("2026-11-14T00:00:01Z", ["a"])]} />);
    expect(screen.getByText("Tools changed")).toBeInTheDocument();
    rerender(<McpToolsPanel baseline={baseline(["a"])} now={NOW} changes={[change("2026-11-13T11:59:59Z", ["a"])]} />);
    expect(screen.queryByText("Tools changed")).not.toBeInTheDocument();
  });

  it("names a change outside the stored tools", () => {
    render(<McpToolsPanel baseline={baseline(["a"])} now={NOW} changes={[{ ...change("2026-11-14T10:00:00Z"), beyondStored: true }]} />);
    expect(screen.getByText("changed beyond the first 500 tools")).toBeInTheDocument();
  });

  it("shows pending, empty and error states", () => {
    const { rerender } = render(<McpToolsPanel pending now={NOW} />);
    expect(screen.getByText("Waiting for the first check")).toBeInTheDocument();
    rerender(<McpToolsPanel baseline={baseline([])} now={NOW} />);
    expect(screen.getByText("This server lists no tools")).toBeInTheDocument();
    rerender(<McpToolsPanel baseline={baseline(["a"])} failure="Login failed" now={NOW} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Login failed");
    expect(screen.getByTestId("mcp-tool-list")).toHaveTextContent("a");
    rerender(<McpToolsPanel pending failure="Could not connect" now={NOW} />);
    expect(screen.queryByText("Waiting for the first check")).not.toBeInTheDocument();
  });

  it("renders hostile tool names as plain text", () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { container } = render(
      <McpToolsPanel baseline={baseline([hostile])} now={NOW} changes={[change("2026-11-14T10:00:00Z", [hostile])]} />,
    );
    fireEvent.click(screen.getByTestId("mcp-change").querySelector("button") as HTMLButtonElement);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText(hostile).length).toBeGreaterThanOrEqual(2);
  });

  it("opens the panel from a button that names the tool count and flags a recent change or a failure", () => {
    const { rerender } = render(<McpToolsButton baseline={baseline(["a", "b"])} now={NOW} changes={[change("2026-11-14T00:00:01Z", ["b"])]} />);
    const button = screen.getByTestId("mcp-tools-button");
    expect(button).toHaveTextContent("2 tools");
    expect(screen.getByTestId("mcp-tools-changed-indicator")).toHaveTextContent("Changed");
    expect(screen.queryByTestId("mcp-tools-panel")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByTestId("mcp-tools-panel")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-list")).toHaveTextContent("b");
    rerender(<McpToolsButton baseline={baseline(["a"])} now={NOW} failure="Login failed" />);
    expect(screen.getByTestId("mcp-tools-button")).toHaveAccessibleName("1 tool (latest check failed)");
    expect(screen.queryByTestId("mcp-tools-changed-indicator")).not.toBeInTheDocument();
  });

  it("says Tools before the first baseline", () => {
    render(<McpToolsButton pending now={NOW} />);
    expect(screen.getByTestId("mcp-tools-button")).toHaveTextContent(/^Tools$/);
  });
});
