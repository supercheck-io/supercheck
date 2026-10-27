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
