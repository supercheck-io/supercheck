import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuditLogsTable } from "./audit-logs-table";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("./audit-table-toolbar", () => ({ AuditTableToolbar: () => null }));
jest.mock("./admin-data-table", () => ({
  AdminDataTable: ({ data }: { data: { id: string }[] }) => (
    <ul>{data.map((row) => <li key={row.id}>{row.id}</li>)}</ul>
  ),
}));

const log = (id: string) => ({ id, action: "login", details: null, createdAt: "2026-01-01T00:00:00.000Z", user: { id: "u", name: "A", email: "a@x.io", image: null } });
const page = (ids: string[], nextCursor: string | null, organizationId = "org-1") => ({
  ok: true,
  json: async () => ({
    success: true,
    data: { organizationId, logs: ids.map(log), filters: { actions: [] }, pagination: { totalCount: 3, nextCursor } },
  }),
});

describe("AuditLogsTable", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("loads the newest page, then continues from the cursor on demand without duplicating rows", async () => {
    fetchMock.mockResolvedValueOnce(page(["a", "b"], "CUR1")).mockResolvedValueOnce(page(["b", "c"], null));
    render(<AuditLogsTable />);

    expect(await screen.findByText("a")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("cursor=");
    expect(screen.getByText(/Showing the newest 2 of 3 events/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));

    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=CUR1");
    expect(screen.getAllByText("b")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load older events" })).not.toBeInTheDocument();
  });

  it("reloads instead of mixing rows when the organization changed between pages", async () => {
    fetchMock
      .mockResolvedValueOnce(page(["a"], "CUR1"))
      .mockResolvedValueOnce(page(["z"], null, "org-2"))
      .mockResolvedValueOnce(page(["n"], null, "org-2"));
    render(<AuditLogsTable />);
    await screen.findByText("a");

    fireEvent.click(screen.getByRole("button", { name: "Load older events" }));

    expect(await screen.findByText("n")).toBeInTheDocument();
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.queryByText("z")).not.toBeInTheDocument();
  });
});
