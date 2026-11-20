import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { dehydrate, QueryClient } from "@tanstack/react-query";
import { QueryProvider, useSeedServerIdentity } from "./query-provider";
import { ShellBootstrapProvider } from "@/components/shell-bootstrap";
import { ADMIN_STATUS_QUERY_KEY, useAdminStatus } from "@/hooks/use-admin-status";

// Its own file: the provider keeps module state per page load, so this must start fresh.
// The real sequence of a full page load: the server's identity is seeded, the first settled identity clears
// the cache, and the saved localStorage cache is restored. The layout's admin status must survive that and
// cause no request; it is never written to the saved cache.
let mockSession: { data: { user: { id: string } } | null; isPending: boolean } = { data: null, isPending: true };
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));

const CACHE_KEY = "supercheck-cache-v4:user-a";
let seen: { isAdmin: boolean; isOrgAdmin: boolean } | undefined;

function Sidebar() {
  useSeedServerIdentity("user-a");
  const { isAdmin, isOrgAdmin } = useAdminStatus();
  useEffect(() => { seen = { isAdmin, isOrgAdmin }; });
  return null;
}

it("keeps the layout's admin status through the cache clear and restore, with no request", async () => {
  const saved = new QueryClient();
  saved.setQueryData(["tests", "p1", "{}"], { data: [] });
  localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), buster: "", clientState: dehydrate(saved) }));
  saved.clear();
  global.fetch = jest.fn();

  const bootstrap = { userId: "user-a", readAt: Date.now(), adminStatus: { isAdmin: false, isOrgAdmin: false } };
  render(
    <QueryProvider>
      <ShellBootstrapProvider value={bootstrap}>
        <Sidebar />
      </ShellBootstrapProvider>
    </QueryProvider>,
  );

  await waitFor(() => expect(seen).toEqual({ isAdmin: false, isOrgAdmin: false }));
  await new Promise((r) => setTimeout(r, 50));
  expect(seen).toEqual({ isAdmin: false, isOrgAdmin: false });
  expect(global.fetch).not.toHaveBeenCalledWith("/api/admin/check");
});

it("never writes the seeded admin status to the saved cache", async () => {
  await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).not.toBeNull());
  await new Promise((r) => setTimeout(r, 600)); // the persister saves on a 500 ms throttle
  const state = JSON.parse(localStorage.getItem(CACHE_KEY) as string).clientState as { queries: Array<{ queryKey: unknown[] }> };
  expect(state.queries.map((q) => q.queryKey[0])).not.toContain(ADMIN_STATUS_QUERY_KEY[0]);
});
