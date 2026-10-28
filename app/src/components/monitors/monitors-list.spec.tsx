import { fireEvent, render, screen } from "@testing-library/react";
import MonitorsList from "./monitors-list";

const useMonitorsMock = jest.fn();
jest.mock("@/hooks/use-monitors", () => ({ useMonitors: () => useMonitorsMock() }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("./columns", () => ({ columns: [] }));
jest.mock("./data-table", () => ({ DataTable: () => <div data-testid="table" /> }));

const base = { monitors: [], isLoading: false, isRestoring: false, error: null, refetch: jest.fn(), invalidate: jest.fn() };

it("shows an error with Retry instead of an empty table when the load fails", () => {
  const refetch = jest.fn();
  useMonitorsMock.mockReturnValue({ ...base, error: new Error("boom"), refetch });
  render(<MonitorsList />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByTestId("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});

it("notes the 200-row cap when it is hit", () => {
  const monitors = Array.from({ length: 200 }, (_, i) => ({ id: `m${i}` }));
  useMonitorsMock.mockReturnValue({ ...base, monitors });
  render(<MonitorsList />);
  expect(screen.getByRole("status")).toHaveTextContent("Showing the latest 200");
});
