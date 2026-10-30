import { fireEvent, render, screen } from "@testing-library/react";

import { DeliveryHistory } from "./delivery-history";

let mockState: { alertHistory: unknown[]; isLoading: boolean; error: Error | null; refetch?: () => void };
jest.mock("@/hooks/use-alerts", () => ({ ALERT_HISTORY_LIMIT: 200, useAlertHistory: () => mockState }));
jest.mock("@/components/alerts/alert-history-panel", () => ({ AlertHistoryPanel: () => <div>history-view</div> }));
let mockProject: { currentProject: unknown; loading: boolean; error: string | null } = {
  currentProject: { id: "p1" },
  loading: false,
  error: null,
};
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => mockProject }));

describe("DeliveryHistory", () => {
  it("shows an error state instead of an empty list when the fetch fails", () => {
    mockState = { alertHistory: [], isLoading: false, error: new Error("boom") };
    render(<DeliveryHistory />);
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to load delivery history");
    expect(screen.queryByText("history-view")).toBeNull();
  });

  it("keeps cached history visible and warns when a refresh fails", () => {
    const refetch = jest.fn();
    mockState = { alertHistory: [{ id: "1" }], isLoading: false, error: new Error("boom"), refetch };
    render(<DeliveryHistory />);
    expect(screen.getByText("history-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("notes when only the latest page of notifications is shown", () => {
    mockState = { alertHistory: Array.from({ length: 200 }, (_, i) => ({ id: String(i) })), isLoading: false, error: null };
    render(<DeliveryHistory />);
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });

  it("explains that history needs a project instead of showing an empty list", () => {
    mockState = { alertHistory: [], isLoading: false, error: null };
    mockProject = { currentProject: null, loading: false, error: null };
    render(<DeliveryHistory />);
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable until a project is selected");
    expect(screen.queryByText("history-view")).toBeNull();
    mockProject = { currentProject: { id: "p1" }, loading: false, error: null };
  });
});
