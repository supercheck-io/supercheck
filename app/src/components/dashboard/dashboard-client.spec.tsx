import { act, render, screen } from "@testing-library/react";
import { useDashboard } from "@/hooks/use-dashboard";
import { DashboardClient } from "./dashboard-client";

jest.mock("@/hooks/use-dashboard", () => ({ useDashboard: jest.fn() }));
jest.mock("@/hooks/use-requirements-stats", () => ({ useRequirementsStats: () => ({ data: undefined, isLoading: false }) }));
jest.mock("@/hooks/use-open-incidents", () => ({ useOpenIncidents: () => ({ data: undefined, isLoading: false }) }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => <nav data-testid="breadcrumbs" /> }));

const seed = { userId: "u1", projectId: "p1", updatedAt: 1, data: {} as never };

describe("DashboardClient", () => {
  beforeEach(() => {
    jest.mocked(useDashboard).mockReturnValue({
      data: undefined, isLoading: true, isRestoring: false, isRefetching: false, error: null,
      refetch: jest.fn(), invalidate: jest.fn(),
    } as unknown as ReturnType<typeof useDashboard>);
  });

  it("shows the skeleton without starting the data hook while the server data is on its way", async () => {
    render(<DashboardClient seed={new Promise(() => {})} />);
    expect(await screen.findByTestId("breadcrumbs")).toBeInTheDocument();
    expect(useDashboard).not.toHaveBeenCalled();
  });

  it("hands the server's data to the data hook once it arrives", async () => {
    await act(async () => { render(<DashboardClient seed={Promise.resolve(seed)} />); });
    expect(useDashboard).toHaveBeenCalledWith(seed);
  });

  it("falls back to the client request when the server had no data", async () => {
    await act(async () => { render(<DashboardClient seed={Promise.resolve(null)} />); });
    expect(useDashboard).toHaveBeenCalledWith(null);
  });
});
