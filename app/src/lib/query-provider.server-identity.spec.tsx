import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { dehydrate, QueryClient, useQueryClient } from "@tanstack/react-query";
import { QueryProvider, shouldRetryQuery, useSeedServerIdentity } from "./query-provider";

// Its own file: the provider keeps module state per page load, so this must start fresh.
let mockSession: { data: { user: { id: string } } | null; isPending: boolean; error?: Error } = { data: null, isPending: true };
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));

const CACHE_KEY = "supercheck-cache-v4:user-a";
let mountedClient: QueryClient | undefined;

function Page({ serverUserId }: { serverUserId: string }) {
  useSeedServerIdentity(serverUserId);
  const client = useQueryClient();
  useEffect(() => { mountedClient = client; }, [client]);
  return <div>page</div>;
}

it("restores the saved cache from the server's identity before the browser's session check returns, and a completed sign-out still clears it", async () => {
  const saved = new QueryClient();
  saved.setQueryData(["alerts-history", "project-1"], [{ id: "saved-alert" }]);
  const payload = JSON.stringify({ timestamp: Date.now(), buster: "", clientState: dehydrate(saved) });
  localStorage.setItem(CACHE_KEY, payload);
  saved.clear();

  const view = render(<QueryProvider><Page serverUserId="user-a" /></QueryProvider>);
  // The browser's check is still pending, yet the saved data is back.
  await waitFor(() => expect(mountedClient?.getQueryData(["alerts-history", "project-1"])).toEqual([{ id: "saved-alert" }]));

  mockSession = { data: null, isPending: false };
  view.rerender(<QueryProvider><Page serverUserId="user-a" /></QueryProvider>);
  await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toBeNull());
  expect(mountedClient?.getQueryData(["alerts-history", "project-1"])).toBeUndefined();

  // better-auth is pending again on every refetch while nobody is signed in (e.g. on /sign-in):
  // the server's id must not come back once a check has completed.
  localStorage.setItem(CACHE_KEY, payload);
  mockSession = { data: null, isPending: true };
  view.rerender(<QueryProvider><Page serverUserId="user-a" /></QueryProvider>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mountedClient?.getQueryData(["alerts-history", "project-1"])).toBeUndefined();
});

describe("shouldRetryQuery", () => {
  const withStatus = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

  it("does not retry client errors", () => {
    for (const status of [400, 401, 403, 404, 422]) expect(shouldRetryQuery(0, withStatus(status))).toBe(false);
  });

  it("retries server errors, timeouts, rate limits and errors without a status, twice", () => {
    for (const error of [withStatus(500), withStatus(503), withStatus(408), withStatus(429), new Error("network")]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
    }
  });
});
