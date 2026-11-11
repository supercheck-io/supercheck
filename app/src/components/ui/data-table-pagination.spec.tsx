import { fireEvent, render, screen } from "@testing-library/react";
import { getCoreRowModel, getFilteredRowModel, getPaginationRowModel, useReactTable } from "@tanstack/react-table";

import { DataTablePagination } from "./data-table-pagination";

// Radix Select needs layout APIs jsdom lacks; a native select exercises the same onValueChange path.
jest.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) => (
    <select aria-label="Rows per page" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));

type Row = { name: string };
const rows: Row[] = Array.from({ length: 23 }, (_, i) => ({ name: i % 2 ? `odd-${i}` : `even-${i}` }));

function Harness({ itemName, filter }: { itemName?: string; filter?: string }) {
  const table = useReactTable({
    data: rows,
    columns: [{ accessorKey: "name" }],
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
    state: filter ? { globalFilter: filter } : undefined,
  });
  return <DataTablePagination table={table} itemName={itemName} />;
}

it("labels the total with the item name and counts pages from the table", () => {
  render(<Harness itemName="monitors" />);
  expect(screen.getByText("Total 23 monitors")).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
});

it("falls back to 'items' and counts only rows left after filtering", () => {
  render(<Harness filter="odd" />);
  expect(screen.getByText("Total 11 items")).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
});

it("moves the table to the next page", () => {
  render(<Harness itemName="jobs" />);
  fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
  expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
});

it("returns to the first page and changes the page size", () => {
  render(<Harness itemName="jobs" />);
  fireEvent.click(screen.getByRole("button", { name: "Go to last page" }));
  expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go to first page" }));
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "25" } });
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
});
