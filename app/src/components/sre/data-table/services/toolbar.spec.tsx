import { fireEvent, render, screen } from "@testing-library/react";
import { getCoreRowModel, getFilteredRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";

import { ServicesToolbar } from "./toolbar";

type Row = { name: string; tier: string; status: string };
const columns: ColumnDef<Row>[] = [
  { accessorKey: "name" },
  { accessorKey: "tier" },
  { accessorKey: "status" },
];

function Harness({ onAdd, setupGuide }: { onAdd?: () => void; setupGuide?: React.ReactNode }) {
  const table = useReactTable({
    data: [{ name: "checkout-api", tier: "1", status: "active" }],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });
  return <ServicesToolbar table={table} onAdd={onAdd} setupGuide={setupGuide} />;
}

describe("ServicesToolbar", () => {
  it("keeps the title and both actions in one row, with search and filters in a row below", () => {
    const onAdd = jest.fn();
    render(<Harness onAdd={onAdd} setupGuide={<button type="button">Setup guide</button>} />);
    const heading = screen.getByRole("heading", { name: "Services" });
    const add = screen.getByTestId("add-service-btn");
    const guide = screen.getByRole("button", { name: "Setup guide" });
    const search = screen.getByLabelText("Search services");

    // heading -> text column -> chip row -> title row
    const titleRow = heading.closest("div")!.parentElement!.parentElement!;
    expect(titleRow).toContainElement(add);
    expect(titleRow).toContainElement(guide);
    expect(titleRow).not.toContainElement(search);

    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("hides Add service without permission and still shows search and filters", () => {
    render(<Harness />);
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
