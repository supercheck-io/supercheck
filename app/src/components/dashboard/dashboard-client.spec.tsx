import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useDashboard } from "@/hooks/use-dashboard";
import { DashboardClient } from "./dashboard-client";

jest.mock("@/hooks/use-dashboard", () => ({
  useDashboard: jest.fn(),
  getDashboardQueryKey: (id: string | null) => ["dashboard", id, "v3"],
  DASHBOARD_STALE_MS: 60_000,
}));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1" } }) }));

let client: QueryClient;
const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
jest.mock("@/hooks/use-requirements-stats", () => ({ useRequirementsStats: () => ({ data: undefined, isLoading: false }) }));
jest.mock("@/hooks/use-open-incidents", () => ({ useOpenIncidents: () => ({ data: undefined, isLoading: false }) }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => <nav data-testid="breadcrumbs" /> }));

const seed = { userId: "u1", projectId: "p1", updatedAt: 1, data: {} as never };

describe("DashboardClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient();
    jest.mocked(useDashboard).mockReturnValue({
      data: undefined, isLoading: true, isRestoring: false, isRefetching: false, error: null,
      refetch: jest.fn(), invalidate: jest.fn(),
    } as unknown as ReturnType<typeof useDashboard>);
  });

  it("shows the skeleton without starting the data hook while the server data is on its way", async () => {
    render(<DashboardClient seed={new Promise(() => {})} />, { wrapper: Wrapper });
    expect(await screen.findByTestId("breadcrumbs")).toBeInTheDocument();
    expect(useDashboard).not.toHaveBeenCalled();
  });

  it("hands the server's data to the data hook once it arrives", async () => {
    await act(async () => { render(<DashboardClient seed={Promise.resolve(seed)} />, { wrapper: Wrapper }); });
    expect(useDashboard).toHaveBeenCalledWith(seed, { refreshOnMount: false });
  });

  it("falls back to the client request when the server had no data", async () => {
    await act(async () => { render(<DashboardClient seed={Promise.resolve(null)} />, { wrapper: Wrapper }); });
    expect(useDashboard).toHaveBeenCalledWith(null, { refreshOnMount: false });
  });

  it("renders fresh cached data at once instead of waiting for the server's read", () => {
    client.setQueryData(["dashboard", "p1", "v3"], { stats: {} });
    render(<DashboardClient seed={new Promise(() => {})} />, { wrapper: Wrapper });
    // Refreshed in the background by the browser, so a newer result replaces it.
    expect(useDashboard).toHaveBeenCalledWith(null, { refreshOnMount: true });
  });

  it("waits for the server's read when the cached data is stale", () => {
    client.setQueryData(["dashboard", "p1", "v3"], { stats: {} }, { updatedAt: Date.now() - 2 * 60_000 });
    render(<DashboardClient seed={new Promise(() => {})} />, { wrapper: Wrapper });
    expect(useDashboard).not.toHaveBeenCalled();
  });
});
