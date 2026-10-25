import { fireEvent, render, screen } from "@testing-library/react";
import { RunsViewTabs } from "./runs-view-tabs";

let mockProjectId = "project-a";
let mockView = "k6";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => "/runs",
  useSearchParams: () => new URLSearchParams({ view: mockView }),
}));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: mockProjectId } }) }));
jest.mock("@/components/runs", () => ({ Runs: () => null }));
jest.mock("./analytics/analytics-filters", () => ({
  AnalyticsFilters: ({ jobs, children }: { jobs: Array<{ name: string }>; children?: React.ReactNode }) => (
    <div><span data-testid="jobs">{jobs.map((j) => j.name).join(",")}</span>{children}</div>
  ),
}));
jest.mock("./analytics/k6-analytics-tab", () => ({
  K6AnalyticsTab: (props: { selectedJob: string; isComparingOpen: boolean; onJobsLoaded: (jobs: Array<{ id: string; name: string }>) => void }) => (
    <div>
      <span data-testid="selection">{props.selectedJob}</span>
      <span data-testid="compare">{String(props.isComparingOpen)}</span>
      <button onClick={() => props.onJobsLoaded([{ id: mockProjectId, name: mockProjectId }])}>Load jobs</button>
      <button onClick={() => props.onJobsLoaded([])}>Load empty</button>
    </div>
  ),
}));
jest.mock("./analytics/playwright-analytics-tab", () => ({
  PlaywrightAnalyticsTab: (props: { selectedJob: string; onJobsLoaded: (jobs: Array<{ id: string; name: string }>) => void }) => (
    <div>
      <span data-testid="selection">{props.selectedJob}</span>
      <button onClick={() => props.onJobsLoaded([{ id: mockProjectId, name: mockProjectId }])}>Load jobs</button>
      <button onClick={() => props.onJobsLoaded([])}>Load empty</button>
    </div>
  ),
}));

describe.each(["k6", "playwright"])("%s project switching", (view) => {
  beforeEach(() => { mockView = view; mockProjectId = "project-a"; });
  it("clears old jobs, selection and comparison before accepting the new project's jobs", () => {
    const { rerender } = render(<RunsViewTabs />);
    fireEvent.click(screen.getByText("Load jobs"));
    expect(screen.getByTestId("selection")).toHaveTextContent("project-a");
    if (view === "k6") {
      fireEvent.click(screen.getByText("Compare Runs"));
      expect(screen.getByTestId("compare")).toHaveTextContent("true");
    }
    mockProjectId = "project-b";
    rerender(<RunsViewTabs />);
    expect(screen.getByTestId("selection")).toBeEmptyDOMElement();
    expect(screen.getByTestId("jobs")).toBeEmptyDOMElement();
    if (view === "k6") expect(screen.getByTestId("compare")).toHaveTextContent("false");
    fireEvent.click(screen.getByText("Load jobs"));
    expect(screen.getByTestId("selection")).toHaveTextContent("project-b");
    expect(screen.getByTestId("jobs")).toHaveTextContent("project-b");
  });
  it("keeps an empty destination project empty", () => {
    const { rerender } = render(<RunsViewTabs />);
    fireEvent.click(screen.getByText("Load jobs"));
    mockProjectId = "empty-project";
    rerender(<RunsViewTabs />);
    fireEvent.click(screen.getByText("Load empty"));
    expect(screen.getByTestId("selection")).toBeEmptyDOMElement();
    expect(screen.getByTestId("jobs")).toBeEmptyDOMElement();
  });
});
