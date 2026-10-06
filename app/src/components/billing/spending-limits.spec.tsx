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
              organizationId: "org_1", enableSpendingLimit: true,
              monthlySpendingLimitDollars: 25,
              notifyAt80Percent: true,
              notificationEmails: [],
            }
          : { organizationId: "org_1", spending: null },
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
  it("preserves a soft cap and a 50-percent-only alert when saving", async () => {
    const onSaved = jest.fn();
    const settings = {
      organizationId: "org_1", enableSpendingLimit: true, monthlySpendingLimitDollars: 12.34,
      hardStopOnLimit: false, notifyAt50Percent: true,
      notifyAt80Percent: false, notifyAt90Percent: false, notifyAt100Percent: false,
      notificationEmails: [],
    };
    const fetchMock = jest.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => url.endsWith("/settings") ? settings : { organizationId: "org_1", spending: null },
    }));
    global.fetch = fetchMock;
    render(<SpendingLimits organizationId="org_1" onSaved={onSaved} />);
    expect(await screen.findByRole("checkbox", { name: "50%" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Stop execution at spending limit" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(request?.[1].body)).toEqual(settings);
  });

  it("rejects fractional cents and saves independently selected alert thresholds", async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => url.endsWith("/settings") ? {
        organizationId: "org_1", enableSpendingLimit: true, monthlySpendingLimitDollars: 10,
        hardStopOnLimit: true, notifyAt80Percent: true, notificationEmails: [],
      } : { organizationId: "org_1", spending: null },
    }));
    global.fetch = fetchMock;
    render(<SpendingLimits />);
    const input = await screen.findByRole("spinbutton");
    fireEvent.change(input, { target: { value: "10.001" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "10.01" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "50%" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "80%" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => call[1]?.method === "PATCH")).toBe(true));
    const request = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(request?.[1].body)).toMatchObject({
      monthlySpendingLimitDollars: 10.01, notifyAt50Percent: true, notifyAt80Percent: false,
    });
  });

  it("prevents saving controls loaded for a different organization", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, json: async () => ({ organizationId: "org_2", enableSpendingLimit: false }),
    });
    render(<SpendingLimits organizationId="org_1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Billing controls could not be loaded");
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("discards spending from another organization on load and after save", async () => {
    const fetchMock = jest.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => url.endsWith("/settings") ? {
        organizationId: "org_1", enableSpendingLimit: true,
        monthlySpendingLimitDollars: 10, hardStopOnLimit: true,
      } : { organizationId: "org_2", spending: {
        limitEnabled: true, currentDollars: 5, remainingDollars: 5,
      } },
    }));
    global.fetch = fetchMock;
    render(<SpendingLimits organizationId="org_1" />);
    await screen.findByRole("button", { name: "Save" });
    expect(screen.queryByText("Current: $5.00")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("Current: $5.00")).not.toBeInTheDocument();
    const request = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(request?.[1].body)).toMatchObject({ organizationId: "org_1" });
  });

  it("clears the old remaining budget when the post-save usage refresh fails", async () => {
    const settings = {
      organizationId: "org_1", enableSpendingLimit: true,
      monthlySpendingLimitDollars: 10, hardStopOnLimit: true,
    };
    const fetchMock = jest.fn().mockImplementation(async (url: string) => ({
      ok: true, json: async () => url.endsWith("/settings") ? settings : {
        organizationId: "org_1", spending: {
          limitEnabled: true, currentDollars: 5, remainingDollars: 5,
        },
      },
    }));
    global.fetch = fetchMock;
    render(<SpendingLimits organizationId="org_1" />);
    await screen.findByText("$5.00 remaining");
    fetchMock.mockImplementation(async (url: string) => ({
      ok: url.endsWith("/settings"), json: async () => settings,
    }));
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByText("$5.00 remaining")).not.toBeInTheDocument());
  });

});
