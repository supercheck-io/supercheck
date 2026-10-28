import { fireEvent, render, screen } from "@testing-library/react";
import StatusPagesList from "./status-pages-list";

const useStatusPagesMock = jest.fn();
jest.mock("@/hooks/use-status-pages", () => ({ useStatusPages: () => useStatusPagesMock() }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: null }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }) }));
jest.mock("@/actions/delete-status-page", () => ({ deleteStatusPage: jest.fn() }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("./create-status-page-form", () => ({ __esModule: true, default: () => null, CreateStatusPageForm: () => null }));

const base = { statusPages: [], isLoading: false, isRestoring: false, error: null, refetch: jest.fn(), statusPageDomain: "x.test" };

it("shows an error with Retry instead of the empty state when the load fails", () => {
  const refetch = jest.fn();
  useStatusPagesMock.mockReturnValue({ ...base, error: new Error("boom"), refetch });
  render(<StatusPagesList />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByText("No status pages yet")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});
