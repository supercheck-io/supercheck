import { fireEvent, render, screen } from "@testing-library/react";
import Jobs from "./index";

const useJobsMock = jest.fn();
const useJobMock = jest.fn((_id: string | null) => ({ data: undefined as unknown, error: null as Error | null }));
let search = "";
const replace = jest.fn();
jest.mock("@/hooks/use-jobs", () => ({
  useJobs: () => useJobsMock(),
  useJob: (id: string | null) => useJobMock(id),
  useJobMutations: () => ({ deleteJob: { mutateAsync: jest.fn() }, updateJob: { mutateAsync: jest.fn() } }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
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

describe("?job= deep link", () => {
  beforeEach(() => { search = "job=old-job"; replace.mockClear(); useJobMock.mockClear(); });
  afterEach(() => { search = ""; });

  it("fetches a job that is not in the capped list instead of dropping the link", () => {
    useJobsMock.mockReturnValue({ ...base, jobs: [{ id: "j1", name: "listed", tests: [] }] });
    useJobMock.mockReturnValue({ data: { id: "old-job", name: "Old job", status: "passed", tests: [] }, error: null });
    render(<Jobs />);
    expect(useJobMock).toHaveBeenCalledWith("old-job");
    expect(replace).not.toHaveBeenCalled();
  });

  it("does not fetch a job that is already in the list", () => {
    useJobsMock.mockReturnValue({ ...base, jobs: [{ id: "old-job", name: "listed", tests: [] }] });
    useJobMock.mockReturnValue({ data: undefined, error: null });
    render(<Jobs />);
    expect(useJobMock).not.toHaveBeenCalledWith("old-job");
  });

  it("strips the param only when the job is not found", () => {
    useJobsMock.mockReturnValue({ ...base, jobs: [{ id: "j1", name: "listed", tests: [] }] });
    useJobMock.mockReturnValue({ data: undefined, error: new Error("Job not found") });
    render(<Jobs />);
    expect(replace).toHaveBeenCalledWith("/jobs", { scroll: false });
  });

  it("keeps the param when the fetch fails for another reason", () => {
    useJobsMock.mockReturnValue({ ...base, jobs: [{ id: "j1", name: "listed", tests: [] }] });
    useJobMock.mockReturnValue({ data: undefined, error: new Error("Failed to fetch job") });
    render(<Jobs />);
    expect(replace).not.toHaveBeenCalled();
  });
});
