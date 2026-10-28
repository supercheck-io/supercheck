import { fireEvent, render, screen } from "@testing-library/react";
import Requirements from "./index";

const useRequirementsMock = jest.fn();
jest.mock("@/hooks/use-requirements", () => ({
  useRequirements: () => useRequirementsMock(),
  useRequirementMutations: () => ({ deleteRequirement: { mutateAsync: jest.fn() } }),
  REQUIREMENT_LINKED_TESTS_QUERY_KEY: ["requirement-linked-tests"],
}));
jest.mock("@/hooks/use-tags", () => ({ useTags: () => ({ tags: [] }) }));
jest.mock("@/hooks/use-rbac-permissions", () => ({
  useRequirementPermissions: () => ({ canEdit: true, canDelete: true, canCreate: true }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [], isPending: false, isFetching: false }),
  useIsRestoring: () => false,
}));
jest.mock("@/actions/requirements", () => ({ getLinkedTests: jest.fn() }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("./columns", () => ({ columns: [] }));
jest.mock("./data-table", () => ({ DataTable: () => <div data-testid="table" /> }));
jest.mock("./requirement-test-data-table", () => ({ __esModule: true, default: () => null }));
jest.mock("./requirement-test-columns", () => ({ createRequirementTestColumns: () => [] }));
jest.mock("./documents-list", () => ({ __esModule: true, default: () => null }));

const base = { requirements: [], isLoading: false, isRestoring: false, error: null, refetch: jest.fn() };

it("shows an error with Retry instead of an empty table when the load fails", () => {
  const refetch = jest.fn();
  useRequirementsMock.mockReturnValue({ ...base, error: new Error("boom"), refetch });
  render(<Requirements />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByTestId("table")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});
