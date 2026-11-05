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
  it("shows the schedule in plain words, with the cron and timezone in the title", () => {
    const { container } = show({ trigger: "schedule", triggeredByName: null, cronSchedule: "0 */4 * * *" });
    expect(screen.getByText("Every 4 hours")).toBeInTheDocument();
    expect(container.querySelector('[title="0 */4 * * * (UTC)"]')).not.toBeNull();
  });

  it("falls back to Scheduler when the job has no cron", () => {
    show({ trigger: "schedule", cronSchedule: null });
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
  });

  it("shows the trigger key name and its owner for API-triggered runs", () => {
    const { container } = show({ trigger: "remote", triggerKeyName: "ci-key", triggeredByName: "Ada Lovelace" });
    expect(screen.getByText("ci-key")).toBeInTheDocument();
    expect(screen.getAllByText("AL").length).toBeGreaterThan(0);
    expect(container.querySelector('[title="API key · Ada Lovelace"]')).not.toBeNull();
  });

  it("shows the user for manual and CLI runs, or Unknown for older runs", () => {
    show({ trigger: "manual", triggeredByName: "Ada Lovelace" });
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    show({ trigger: "manual", triggeredByName: null });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("filters by the displayed value", () => {
    const accessor = (column as unknown as { accessorFn: (row: Partial<TestRun>) => string }).accessorFn;
    expect(accessor({ trigger: "schedule", cronSchedule: "30 9 * * *" })).toBe("Daily at 09:30");
    expect(accessor({ trigger: "schedule" })).toBe("Scheduler");
    expect(accessor({ trigger: "remote", triggerKeyName: "ci-key", triggeredByName: "Ada" })).toBe("ci-key");
    expect(accessor({ trigger: "manual", triggeredByName: null })).toBe("");
  });
});
