import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { dehydrate, QueryClient, useQueryClient } from "@tanstack/react-query";
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
let mountedClient: QueryClient | undefined;

function Sidebar() {
  useSeedServerIdentity("user-a");
  const { isAdmin, isOrgAdmin } = useAdminStatus();
  const client = useQueryClient();
  useEffect(() => { seen = { isAdmin, isOrgAdmin }; mountedClient = client; });
  return null;
}

it("keeps the layout's admin status through the cache clear and restore, with no request, and never saves it", async () => {
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

  // Never written to the saved cache: a control query written now is saved, the seeded admin status is not.
  mountedClient!.setQueryData(["control"], { ok: true });
  await waitFor(() => {
    const keys = (JSON.parse(localStorage.getItem(CACHE_KEY) as string).clientState.queries as Array<{ queryKey: unknown[] }>)
      .map((q) => q.queryKey[0]);
    expect(keys).toContain("control");
    expect(keys).not.toContain(ADMIN_STATUS_QUERY_KEY[0]);
  }, { timeout: 2000 });
});
