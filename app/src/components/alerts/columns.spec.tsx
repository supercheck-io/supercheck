import { render, screen } from "@testing-library/react";
import type { CellContext } from "@tanstack/react-table";

import { columns } from "./columns";
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

  it("offers Open incident for a sent failure with no incident", () => {
    renderIncidentCell({});
    expect(screen.getByRole("button", { name: "open api" })).toHaveAttribute("data-alert-id", "a1");
  });

  it.each([{ type: "monitor_recovery" }, { status: "failed" as const }])("shows a dash for %j", (alert) => {
    renderIncidentCell(alert);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("-")).toBeInTheDocument();
  });
});
