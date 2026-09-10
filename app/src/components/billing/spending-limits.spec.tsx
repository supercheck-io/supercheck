import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SpendingLimits } from "./spending-limits";

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

describe("SpendingLimits loading recovery", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("prevents saving defaults after a failed load and supports retry", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false });
    global.fetch = fetchMock;
    render(<SpendingLimits />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing controls could not be loaded",
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();

    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/settings")
          ? {
              enableSpendingLimit: true,
              monthlySpendingLimitDollars: 25,
              notifyAt80Percent: true,
              notificationEmails: [],
            }
          : { spending: null },
    }));
    fireEvent.click(
      screen.getByRole("button", { name: "Retry billing controls" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", {
          name: "Monthly overage limit in USD",
        }),
      ).toHaveValue(25),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(fetchMock.mock.calls.every((call) => call.length === 1)).toBe(true);
  });
});
