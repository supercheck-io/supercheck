import { render, screen } from "@testing-library/react";

import { columns } from "./columns";
import type { Monitor } from "./schema";

jest.mock("./data-table-row-actions", () => ({ DataTableRowActions: () => null }));

const statusCell = (original: Partial<Monitor>) => {
  const column = columns.find((c) => "accessorKey" in c && c.accessorKey === "status")!;
  const cell = column.cell as (props: unknown) => React.ReactNode;
  return render(<>{cell({ row: { original: { id: "m-1", ...original }, getValue: () => original.status } })}</>);
};

it("shows the real status plus an icon-only maintenance chip while a window covers the monitor", () => {
  statusCell({ status: "down", inMaintenance: true });
  expect(screen.getByText("Down")).toBeInTheDocument();
  expect(screen.queryByText("Maintenance")).toBeNull();
  expect(screen.getByRole("img", { name: "In maintenance: alerts muted" })).toBeInTheDocument();
});

it("shows a heartbeat schedule in the body font, not the URL monospace", () => {
  const column = columns.find((c) => "accessorKey" in c && c.accessorKey === "target")!;
  const cell = column.cell as (props: unknown) => React.ReactNode;
  const original = { id: "h", type: "heartbeat", frequencyMinutes: 60, config: { heartbeat: { graceMinutes: 10 } } };
  render(<>{cell({ row: { original, getValue: () => "" } })}</>);
  const text = screen.getByText("Every 1 h, grace 10 min");
  expect(text).not.toHaveClass("font-mono");
});

it("shows only the status outside a window", () => {
  statusCell({ status: "up", inMaintenance: false });
  expect(screen.getByText("Up")).toBeInTheDocument();
  expect(screen.queryByTestId("monitor-maintenance-chip")).toBeNull();
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
