import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  getProjectSetupQueryKey,
  getProjectSetupSummaryQueryKey,
  setProjectSetupData,
  USER_PREFERENCES_QUERY_KEY,
  useProjectSetup,
  useProjectSetupSummary,
  useUserPreferences,
} from "./use-project-setup";

// The saved query cache (query-provider.tsx) skips a query whose meta.persist is false. These queries decide
// where /setup sends the user, so a reload must never restore a stale copy of them.
describe("project setup queries stay out of the saved cache", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("marks setup, summary and preferences as memory-only", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    renderHook(() => { useProjectSetup("p1"); useProjectSetupSummary("p1"); useUserPreferences(); }, { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    for (const queryKey of [getProjectSetupQueryKey("p1"), getProjectSetupSummaryQueryKey("p1"), USER_PREFERENCES_QUERY_KEY]) {
      expect(client.getQueryCache().find({ queryKey })?.meta).toEqual({ persist: false });
    }
    client.clear();
  });
});

describe("setProjectSetupData", () => {
  it("keeps the last known aiTestsLocked when a write response does not compute it", () => {
    const client = new QueryClient();
    const key = getProjectSetupQueryKey("p1");
    const base = { state: { status: "in_progress" }, checklist: { done: 1, total: 2 }, projectEmpty: false };
    client.setQueryData(key, { ...base, aiTestsLocked: true });
    setProjectSetupData(client, "p1", { ...base, aiTestsLocked: null } as never);
    expect((client.getQueryData(key) as { aiTestsLocked: boolean | null }).aiTestsLocked).toBe(true);
    setProjectSetupData(client, "p1", { ...base, aiTestsLocked: false } as never);
    expect((client.getQueryData(key) as { aiTestsLocked: boolean | null }).aiTestsLocked).toBe(false);
  });
});
