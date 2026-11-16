import { fireEvent, render, screen } from "@testing-library/react";
import { getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

import { ServicesToolbar } from "./toolbar";

type Row = { name: string; tier: string; status: string };
const columns: ColumnDef<Row>[] = [
  { accessorKey: "name" },
  { accessorKey: "tier" },
  { accessorKey: "status" },
];

function Harness() {
  const table = useReactTable({
    data: [{ name: "checkout-api", tier: "1", status: "active" }],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  return <ServicesToolbar table={table} />;
}

describe("ServicesToolbar", () => {
  it("holds search and filters only; the title and Add service live in the page header", () => {
    render(<Harness />);
    expect(screen.queryByRole("heading", { name: "Services" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-service-btn")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search services")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tier/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Status/ })).toBeInTheDocument();
  });

  it("searches and clears", () => {
    render(<Harness />);
    const search = screen.getByLabelText("Search services");
    fireEvent.change(search, { target: { value: "check" } });
    expect(search).toHaveValue("check");
    fireEvent.click(screen.getByRole("button", { name: "Clear service search" }));
    expect(search).toHaveValue("");
  });
});
