import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import {
  formatLocalDateParam,
  MONITOR_PERMISSIONS_KEY,
  useMonitorPermissions,
} from "./use-monitor-details";

describe("formatLocalDateParam", () => {
  it("formats the selected local calendar day without shifting to UTC", () => {
    // new Date(year, month, day) creates a date at local midnight.
    // The formatLocalDateParam function formats based on local components,
    // ensuring it doesn't get shifted to the previous day in UTC representation.
    const selectedDate = new Date(2026, 5, 16);
    expect(formatLocalDateParam(selectedDate)).toBe("2026-06-16");
  });

  it("pads single-digit months and days", () => {
    expect(formatLocalDateParam(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("useMonitorPermissions", () => {
  it("refetches on mount so role changes show up despite the 30 minute default staleTime", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30 * 60 * 1000 } } });
    client.setQueryData([...MONITOR_PERMISSIONS_KEY, "m1"], {
      userRole: "project_viewer",
      canEdit: false,
      canDelete: false,
      canToggle: false,
    });
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { userRole: "project_editor", canEdit: true, canDelete: false, canToggle: true } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useMonitorPermissions("m1"), { wrapper });

    await waitFor(() => expect(result.current.canEdit).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith("/api/monitors/m1/permissions");
  });
});
