import { fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";

import { NotificationChannelsDataTable } from "./notification-channels-data-table";

// Radix Select needs layout APIs jsdom lacks; a native select exercises the same onValueChange path.
jest.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) => (
    <select aria-label="Rows per page" value={value} onChange={(event) => onValueChange(event.target.value)}>{children}</select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));

type Channel = { name: string };
const columns: ColumnDef<Channel>[] = [{ accessorKey: "name", header: "Name" }];
const channels = (count: number) => Array.from({ length: count }, (_, i) => ({ name: `channel-${i + 1}` }));

it("fits pages to the default size and pages through channels", () => {
  render(<NotificationChannelsDataTable columns={columns} data={channels(25)} />);

  expect(screen.getByText("Total 25 channels")).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  expect(screen.getByText("channel-1")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
  expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  expect(screen.getByText("channel-11")).toBeInTheDocument();
});

it("keeps a manual page size", () => {
  render(<NotificationChannelsDataTable columns={columns} data={channels(25)} />);

  fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "25" } });
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  expect(screen.getByText("channel-25")).toBeInTheDocument();
});

it("stays on a valid page when the channel count drops", () => {
  const { rerender } = render(<NotificationChannelsDataTable columns={columns} data={channels(25)} />);
  fireEvent.click(screen.getByRole("button", { name: "Go to last page" }));
  expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();

  rerender(<NotificationChannelsDataTable columns={columns} data={channels(4)} />);
  expect(screen.getByText("Total 4 channels")).toBeInTheDocument();
  expect(screen.getByText("channel-4")).toBeInTheDocument();
});
