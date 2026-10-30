import { fireEvent, render, screen, act } from "@testing-library/react";
import { toast } from "sonner";
import { DataTableRowActions } from "./data-table-row-actions";
import { deleteRun } from "@/actions/delete-run";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn(), info: jest.fn() } }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: (e: unknown) => void; disabled?: boolean }) => (
    <button role="menuitem" disabled={disabled} onClick={onClick}>{children}</button>
  ),
}));
jest.mock("@/actions/delete-run", () => ({ deleteRun: jest.fn() }));

const row = { original: { id: "run-1" } } as never;

async function openAndConfirmDelete() {
  fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
}

describe("runs DataTableRowActions delete", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it("refreshes the list and shows an info toast when the delete outlives the 30s timeout", async () => {
    jest.mocked(deleteRun).mockReturnValue(new Promise(() => {}));
    const onDelete = jest.fn();
    render(<DataTableRowActions row={row} onDelete={onDelete} />);
    await openAndConfirmDelete();

    await act(async () => {
      jest.advanceTimersByTime(30000);
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith("Still deleting", expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("explains why Delete is disabled for viewers", async () => {
    render(<DataTableRowActions row={row} canDelete={false} />);
      expect(screen.getByRole("menuitem", { name: /delete/i })).toBeDisabled();
    // Radix tooltip opens on focus of the trigger wrapper.
    fireEvent.focus(screen.getByRole("menuitem", { name: /delete/i }).parentElement!);
    expect((await screen.findAllByText("Insufficient permissions to delete runs")).length).toBeGreaterThan(0);
  });
});
