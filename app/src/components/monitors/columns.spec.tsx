import { render, screen } from "@testing-library/react";

import { columns } from "./columns";
import type { Monitor } from "./schema";

jest.mock("./data-table-row-actions", () => ({ DataTableRowActions: () => null }));

const statusCell = (original: Partial<Monitor>) => {
  const column = columns.find((c) => "accessorKey" in c && c.accessorKey === "status")!;
  const cell = column.cell as (props: unknown) => React.ReactNode;
  return render(<>{cell({ row: { original: { id: "m-1", ...original }, getValue: () => original.status } })}</>);
};

it("shows the real status plus a Maintenance pill while a window covers the monitor", () => {
  statusCell({ status: "down", inMaintenance: true });
  expect(screen.getByText("Down")).toBeInTheDocument();
  expect(screen.getByText("Maintenance")).toBeInTheDocument();
});

it("shows only the status outside a window", () => {
  statusCell({ status: "up", inMaintenance: false });
  expect(screen.getByText("Up")).toBeInTheDocument();
  expect(screen.queryByText("Maintenance")).toBeNull();
});

it("never shows two Maintenance pills", () => {
  statusCell({ status: "maintenance", inMaintenance: true });
  expect(screen.getAllByText("Maintenance")).toHaveLength(1);
});

it("the Maintenance filter matches a covered monitor whatever its status", () => {
  const column = columns.find((c) => "accessorKey" in c && c.accessorKey === "status")!;
  const filter = column.filterFn as (row: unknown, id: string, value: string[]) => boolean;
  const row = (original: Partial<Monitor>) => ({ original, getValue: () => original.status });
  expect(filter(row({ status: "down", inMaintenance: true }), "status", ["maintenance"])).toBe(true);
  expect(filter(row({ status: "down", inMaintenance: false }), "status", ["maintenance"])).toBe(false);
  expect(filter(row({ status: "down", inMaintenance: true }), "status", ["up"])).toBe(false);
  expect(filter(row({ status: "up" }), "status", ["up"])).toBe(true);
});
