import { fireEvent, render, screen } from "@testing-library/react";
import Jobs from "./index";

const useJobsMock = jest.fn();
jest.mock("@/hooks/use-jobs", () => ({
  useJobs: () => useJobsMock(),
  useJobMutations: () => ({ deleteJob: { mutateAsync: jest.fn() }, updateJob: { mutateAsync: jest.fn() } }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("./job-context", () => ({ useJobContext: () => ({}) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: null }) }));
jest.mock("./columns", () => ({ columns: [] }));
jest.mock("./data-table", () => ({ DataTable: () => <div data-testid="table" /> }));

const base = { jobs: [], isLoading: false, isRestoring: false, error: null, refetch: jest.fn() };

it("shows an error with Retry instead of an empty table when the load fails", () => {
  const refetch = jest.fn();
  useJobsMock.mockReturnValue({ ...base, error: new Error("boom"), refetch });
  render(<Jobs />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByTestId("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});

it("notes the 100-row cap when it is hit", () => {
  const jobs = Array.from({ length: 100 }, (_, i) => ({ id: `j${i}`, name: `job ${i}`, tests: [] }));
  useJobsMock.mockReturnValue({ ...base, jobs });
  render(<Jobs />);
  expect(screen.getByRole("status")).toHaveTextContent("Showing the latest 100");
});
