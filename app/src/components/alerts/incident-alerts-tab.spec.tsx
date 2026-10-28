import { render, screen } from "@testing-library/react";

import { IncidentAlertsTab } from "./incident-alerts-tab";

let mockState: { alertHistory: unknown[]; isLoading: boolean; error: Error | null };
jest.mock("@/hooks/use-alerts", () => ({ ALERT_HISTORY_LIMIT: 200, useAlertHistory: () => mockState }));
jest.mock("@/components/alerts/sre-alerts-view", () => ({ SreAlertsView: () => <div>signals-view</div> }));
jest.mock("@/components/alerts/alert-history-panel", () => ({ AlertHistoryPanel: () => <div>history-view</div> }));

describe("IncidentAlertsTab", () => {
  it("shows an error state instead of an empty list when the fetch fails", () => {
    mockState = { alertHistory: [], isLoading: false, error: new Error("boom") };
    render(<IncidentAlertsTab view="signals" onViewChange={jest.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load alerts");
    expect(screen.queryByText("signals-view")).toBeNull();
  });

  it("notes when only the latest page of notifications is shown", () => {
    mockState = { alertHistory: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })), isLoading: false, error: null };
    render(<IncidentAlertsTab view="signals" onViewChange={jest.fn()} />);
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });
});
