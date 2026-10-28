import { render, screen } from "@testing-library/react";
import type { CellContext, ColumnDef } from "@tanstack/react-table";

import { createdByColumn, type CreatedByFields } from "./created-by-column";

function renderCell(column: ColumnDef<CreatedByFields>, original: CreatedByFields) {
  const cell = column.cell as (ctx: CellContext<CreatedByFields, unknown>) => React.ReactNode;
  render(<>{cell({ row: { original } } as CellContext<CreatedByFields, unknown>)}</>);
}

describe("createdByColumn", () => {
  const column = createdByColumn<CreatedByFields>();

  it("sorts and filters by the creator's name", () => {
    const accessor = (column as unknown as { accessorFn: (row: CreatedByFields) => string }).accessorFn;
    expect(accessor({ createdByName: "Ada" })).toBe("Ada");
    expect(accessor({ createdByName: null })).toBe("");
  });

  it("shows the creator's initials with the name for screen readers, or Unknown when the user was deleted", () => {
    renderCell(column, { createdByName: "Ada Lovelace" });
    // Initials appear twice: in the avatar fallback and as the visible label.
    expect(screen.getAllByText("AL")).toHaveLength(2);
    expect(screen.getByText("Ada Lovelace")).toHaveClass("sr-only");
    renderCell(column, { createdByName: null });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
});
