jest.mock("./data-table-row-actions", () => ({ DataTableRowActions: () => null }));

import { render, screen } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";

import { columns } from "./columns";
import type { TestRun } from "./schema";

const column = columns.find((candidate) => candidate.id === "triggeredBy")!;
const cell = column.cell as (ctx: CellContext<TestRun, unknown>) => React.ReactNode;
const show = (run: Partial<TestRun>) =>
  render(<>{cell({ row: { original: run } } as unknown as CellContext<TestRun, unknown>)}</>);

describe("runs Triggered by column", () => {
  it("shows Schedule for scheduled runs", () => {
    show({ trigger: "schedule", triggeredByName: null });
    expect(screen.getByText("Schedule")).toBeInTheDocument();
  });

  it("shows the trigger key name for API-triggered runs", () => {
    show({ trigger: "remote", triggerKeyName: "ci-key", triggeredByName: "Ada" });
    expect(screen.getByText("ci-key")).toBeInTheDocument();
    expect(screen.queryByText("Ada")).toBeNull();
  });

  it("shows the user for manual and CLI runs, or Unknown for older runs", () => {
    show({ trigger: "manual", triggeredByName: "Ada Lovelace" });
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    show({ trigger: "manual", triggeredByName: null });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("filters by the displayed value", () => {
    const accessor = (column as unknown as { accessorFn: (row: Partial<TestRun>) => string }).accessorFn;
    expect(accessor({ trigger: "schedule" })).toBe("Schedule");
    expect(accessor({ trigger: "remote", triggerKeyName: "ci-key", triggeredByName: "Ada" })).toBe("ci-key");
    expect(accessor({ trigger: "manual", triggeredByName: null })).toBe("");
  });
});
