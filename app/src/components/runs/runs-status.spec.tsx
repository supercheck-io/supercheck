jest.mock("./data-table-row-actions", () => ({ DataTableRowActions: () => null }));

import type { TestRun } from "./schema";
import { columns } from "./columns";

const accessor = (columns.find((c) => c.id === "status") as unknown as {
  accessorFn: (row: Partial<TestRun>) => string;
}).accessorFn;

describe("runs Status column", () => {
  it("shows queued runs as queued, not running", () => {
    expect(accessor({ status: "queued" })).toBe("queued");
  });

  it("shows a user-cancelled run as cancelled, not error", () => {
    expect(accessor({ status: "error", cancelled: true })).toBe("cancelled");
    expect(accessor({ status: "error" })).toBe("error");
  });
});
