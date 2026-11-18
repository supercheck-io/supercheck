import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { dehydrate, QueryClient, useQueryClient } from "@tanstack/react-query";
import { QueryProvider, useSeedServerIdentity } from "./query-provider";

// Its own file: the provider keeps module state per page load, so this must start fresh.
let mockSession: { data: null; isPending: boolean; error?: { status: number } } = { data: null, isPending: true };
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));

const CACHE_KEY = "supercheck-cache-v4:user-a";
let mountedClient: QueryClient | undefined;

function Page() {
  useSeedServerIdentity("user-a");
  const client = useQueryClient();
  useEffect(() => { mountedClient = client; }, [client]);
  return <div>page</div>;
}

it("keeps the server's identity when the first check fails on a server error, and treats a 401 as signed out", async () => {
  const saved = new QueryClient();
  saved.setQueryData(["alerts-history", "project-1"], [{ id: "saved-alert" }]);
  localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), buster: "", clientState: dehydrate(saved) }));
  saved.clear();

  // A 5xx is not a sign-out (AuthGuard keeps the page too): the saved cache is restored.
  mockSession = { data: null, isPending: false, error: { status: 503 } };
  const view = render(<QueryProvider><Page /></QueryProvider>);
  await waitFor(() => expect(mountedClient?.getQueryData(["alerts-history", "project-1"])).toEqual([{ id: "saved-alert" }]));

  // A 401 is an answer: signed out, so the cache is cleared.
  mockSession = { data: null, isPending: false, error: { status: 401 } };
  view.rerender(<QueryProvider><Page /></QueryProvider>);
  await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toBeNull());
  expect(mountedClient?.getQueryData(["alerts-history", "project-1"])).toBeUndefined();
});
