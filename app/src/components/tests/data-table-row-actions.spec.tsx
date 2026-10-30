import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataTableRowActions } from "./data-table-row-actions";
import { DASHBOARD_QUERY_KEY } from "@/hooks/use-dashboard";
import { TESTS_QUERY_KEY } from "@/hooks/use-tests";

const mockQc = { cancelQueries: jest.fn(), invalidateQueries: jest.fn() };
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => mockQc }));
jest.mock("sonner", () => ({ toast: { loading: jest.fn(() => "t"), success: jest.fn(), error: jest.fn() } }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: (e: unknown) => void; disabled?: boolean }) => (
    <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));
jest.mock("@/actions/delete-test", () => ({ deleteTest: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("@/hooks/use-rbac-permissions", () => ({ useTestPermissions: () => ({ canEditTest: true, canDeleteTest: true }) }));

it("invalidates the dashboard as well as the tests list after a delete", async () => {
  render(<DataTableRowActions row={{ original: { id: "t1", title: "T" } } as never} />);
  fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(mockQc.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: DASHBOARD_QUERY_KEY })));
  expect(mockQc.invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: TESTS_QUERY_KEY }));
});
