import { render, screen } from "@testing-library/react";
import type { SreConnectorListItem } from "@/actions/sre-connectors";
import { columns } from "./columns";

type CellRenderer = (context: { row: { original: SreConnectorListItem } }) => React.ReactNode;

function renderTypeCell(type: SreConnectorListItem["type"]) {
  const column = columns.find((candidate) => "accessorKey" in candidate && candidate.accessorKey === "type");
  const cell = column?.cell as CellRenderer;
  render(<>{cell({ row: { original: { type } as SreConnectorListItem } })}</>);
}

describe("connector type column", () => {
  it.each([
    ["supercheck_native", "Native"],
    ["mcp", "Agent tools"],
    ["prometheus", "Live search"],
  ] as const)("labels %s as %s", (type, label) => {
    renderTypeCell(type);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("connector status column", () => {
  function renderStatus(connector: Partial<SreConnectorListItem>) {
    const column = columns.find((candidate) => "accessorKey" in candidate && candidate.accessorKey === "status");
    const cell = column?.cell as CellRenderer;
    render(<>{cell({ row: { original: connector as SreConnectorListItem } })}</>);
  }

  it("shows the last validation error under a status that is not valid", () => {
    renderStatus({ status: "unreachable", lastValidationError: "HTTP 401 from endpoint" });
    expect(screen.getByText("HTTP 401 from endpoint")).toBeInTheDocument();
  });

  it("hides the error when the connector is valid", () => {
    renderStatus({ status: "valid", lastValidationError: "old error" });
    expect(screen.queryByText("old error")).not.toBeInTheDocument();
  });
});
