import { render, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RunsClient } from "./runs-client";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), info: jest.fn() } }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("./columns", () => ({ createColumns: () => [] }));
jest.mock("./data-table", () => ({ DataTable: () => null }));

describe("RunsClient", () => {
  afterEach(() => jest.restoreAllMocks());

  it("loads the full list instead of a fixed 100 and says when it is truncated", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], pagination: { total: 1500, hasNextPage: true } }),
    });
    global.fetch = fetchMock as never;
    render(<RunsClient />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).not.toContain("limit=100");
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
  });
});
