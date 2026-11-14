import { render, screen } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";

import { columns, deliveryAttempts } from "./columns";
import type { AlertHistory } from "./schema";

jest.mock("./open-incident-cell", () => ({
  ...jest.requireActual("./open-incident-cell"),
  OpenIncidentCell: ({ alertHistoryId, targetName }: { alertHistoryId: string; targetName: string }) => (
    <button type="button" data-alert-id={alertHistoryId}>open {targetName}</button>
  ),
}));

const incidentColumn = columns.find((column) => column.id === "incident")!;
const renderIncidentCell = (alert: Partial<AlertHistory>) => {
  const original = { id: "a1", type: "monitor_failure", status: "sent", message: "Down", targetName: "api", incident: null, ...alert } as AlertHistory;
  const cell = incidentColumn.cell as (ctx: CellContext<AlertHistory, unknown>) => React.ReactNode;
  render(<>{cell({ row: { original } } as CellContext<AlertHistory, unknown>)}</>);
};

describe("alert history Incident column", () => {
  it("links to the incident the alert belongs to", () => {
    renderIncidentCell({ incident: { id: "inc-1", number: 7 } });
    expect(screen.getByRole("link", { name: "#7" })).toHaveAttribute("href", "/incidents/inc-1");
  });

  it("offers Open incident for a failed delivery too", () => {
    renderIncidentCell({ status: "failed" });
    expect(screen.getByRole("button", { name: "open api" })).toBeInTheDocument();
  });

  it("offers Open incident for a sent failure with no incident", () => {
    renderIncidentCell({});
    expect(screen.getByRole("button", { name: "open api" })).toHaveAttribute("data-alert-id", "a1");
  });

  it.each([{ type: "monitor_recovery" }, { status: "pending" as never }])("shows a dash for %j", (alert) => {
    renderIncidentCell(alert);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});

describe("alert history Status column", () => {
  const statusColumn = columns.find((column) => (column as { accessorKey?: string }).accessorKey === "status")!;
  const renderStatus = (alert: Partial<AlertHistory>) => {
    const original = { id: "a1", type: "monitor_failure", status: "failed", message: "Down", targetName: "api", ...alert } as AlertHistory;
    const cell = statusColumn.cell as (ctx: CellContext<AlertHistory, unknown>) => React.ReactNode;
    render(<>{cell({ row: { original, getValue: () => original.status } } as unknown as CellContext<AlertHistory, unknown>)}</>);
  };

  it("lists the delivery attempts behind a focusable badge", () => {
    renderStatus({ metadata: { delivery: { attemptLog: [{ n: 1, status: 503, ms: 210 }, { n: 2, error: "timeout", ms: 10000 }] } } });
    expect(screen.getByTestId("delivery-attempts")).toHaveAccessibleName("failed, 2 attempts");
  });

  it("shows a plain badge without an attempt log", () => {
    renderStatus({ status: "sent" });
    expect(screen.queryByTestId("delivery-attempts")).toBeNull();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("parses only well-formed attempts, at most 4", () => {
    const log = [{ n: 1, ms: 1 }, { bad: true }, { n: 2, ms: 1 }, { n: 3, ms: 1 }, { n: 4, ms: 1 }, { n: 5, ms: 1 }];
    expect(deliveryAttempts({ metadata: { delivery: { attemptLog: log } } } as unknown as AlertHistory).map((a) => a.n)).toEqual([1, 2, 3, 4]);
    expect(deliveryAttempts({ metadata: { delivery: { attemptLog: "x" } } } as unknown as AlertHistory)).toEqual([]);
  });
});
