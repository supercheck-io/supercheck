import { fireEvent, render, screen } from "@testing-library/react";
import EditJobPage from "./page";

const useJobMock = jest.fn();
const push = jest.fn();
jest.mock("@/hooks/use-jobs", () => ({ useJob: () => useJobMock() }));
jest.mock("next/navigation", () => ({ useParams: () => ({ id: "j1" }), useRouter: () => ({ push }) }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
jest.mock("@/components/jobs/edit-job", () => ({ __esModule: true, default: () => <div data-testid="editor" /> }));
jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));

beforeEach(() => push.mockClear());

it("redirects to the jobs list only when the job is not found", () => {
  useJobMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("Job not found"), refetch: jest.fn() });
  render(<EditJobPage />);
  expect(push).toHaveBeenCalledWith("/jobs");
});

it("shows an error with Retry, and stays, when the load fails for another reason", () => {
  const refetch = jest.fn();
  useJobMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error("Failed to fetch job"), refetch });
  render(<EditJobPage />);
  expect(push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});
