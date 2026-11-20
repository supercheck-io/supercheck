import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShellBootstrapProvider, type ShellBootstrap } from "@/components/shell-bootstrap";
import { ADMIN_STATUS_QUERY_KEY, useAdminStatus } from "./use-admin-status";
import { IMPERSONATION_STATUS_QUERY_KEY, useImpersonationStatus } from "./use-impersonation-status";
import { useProjectSetupSummary, useUserPreferences } from "./use-project-setup";

let mockSessionUserId: string | undefined = "u1";
jest.mock("@/utils/auth-client", () => ({
  useSession: () => ({ data: mockSessionUserId ? { user: { id: mockSessionUserId } } : null }),
}));

// The server layout reads these for each page load; the hooks must start from those values instead of
// requesting them again, and fall back to their own request when a value is missing.
const fullBootstrap = (): ShellBootstrap => ({
  userId: "u1",
  readAt: Date.now(),
  adminStatus: { isAdmin: false, isOrgAdmin: true },
  impersonation: { isImpersonating: true, impersonatedUser: { id: "u2", name: "Pat", email: "p@x" }, originalAdmin: null },
  preferences: { persona: "sre", seen: true },
  setupSummary: { projectId: "p1", summary: { status: "in_progress", done: 1, total: 4, projectEmpty: false } },
});

function setup(bootstrap?: ShellBootstrap) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      {bootstrap ? <ShellBootstrapProvider value={bootstrap}>{children}</ShellBootstrapProvider> : children}
    </QueryClientProvider>
  );
  return { client, wrapper };
}

describe("shell hooks seeded by the server layout", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; mockSessionUserId = "u1"; });

  it("make no request when the layout supplied every value", async () => {
    global.fetch = jest.fn();
    const { wrapper } = setup(fullBootstrap());
    const { result } = renderHook(
      () => ({
        admin: useAdminStatus(),
        impersonation: useImpersonationStatus(),
        prefs: useUserPreferences(),
        summary: useProjectSetupSummary("p1"),
      }),
      { wrapper },
    );
    expect(result.current.admin).toMatchObject({ isAdmin: false, isOrgAdmin: true, isLoading: false });
    expect(result.current.impersonation).toMatchObject({ isImpersonating: true, isKnown: true, impersonatedUser: { name: "Pat" } });
    expect(result.current.prefs.data).toEqual({ persona: "sre", seen: true });
    expect(result.current.summary.data).toMatchObject({ done: 1, total: 4 });
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps seeded admin and impersonation status out of the saved cache", () => {
    const { client, wrapper } = setup(fullBootstrap());
    renderHook(() => { useAdminStatus(); useImpersonationStatus(); }, { wrapper });
    for (const queryKey of [ADMIN_STATUS_QUERY_KEY, IMPERSONATION_STATUS_QUERY_KEY]) {
      expect(client.getQueryCache().find({ queryKey })?.meta).toEqual({ persist: false });
    }
  });

  it("requests the setup summary for a project the layout did not render", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "completed", done: 4, total: 4, projectEmpty: false }) });
    const { wrapper } = setup(fullBootstrap());
    const { result } = renderHook(() => useProjectSetupSummary("p2"), { wrapper });
    await waitFor(() => expect(result.current.data?.status).toBe("completed"));
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/p2/setup?summary=1", { cache: "no-store" });
  });

  it("request their values when there is no layout seed", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ isAdmin: true, isOrgAdmin: false, isImpersonating: false, persona: null, seen: false }) });
    const { wrapper } = setup();
    renderHook(() => { useAdminStatus(); useImpersonationStatus(); useUserPreferences(); }, { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining(["/api/admin/check", "/api/auth/impersonation-status", "/api/me/preferences"]));
  });

  it("refetches a seed once it is older than the fresh window", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ isAdmin: false, isOrgAdmin: false }) });
    const { wrapper } = setup({ ...fullBootstrap(), readAt: Date.now() - 60_000 });
    renderHook(() => useAdminStatus(), { wrapper });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/admin/check"));
  });

  it("skips the impersonation request while disabled, and is not known yet", async () => {
    global.fetch = jest.fn();
    const { wrapper } = setup();
    const { result } = renderHook(() => useImpersonationStatus({ enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ isImpersonating: false, isKnown: false });
  });

  it("uses the layout's values while the browser session check is pending", async () => {
    mockSessionUserId = undefined;
    global.fetch = jest.fn();
    const { wrapper } = setup(fullBootstrap());
    const { result } = renderHook(() => useAdminStatus(), { wrapper });
    expect(result.current.isOrgAdmin).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores the layout's values once another user is signed in, and asks again", async () => {
    mockSessionUserId = "u9";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ isImpersonating: false }) });
    const { wrapper } = setup(fullBootstrap());
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper });
    expect(result.current.isKnown).toBe(false);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/auth/impersonation-status"));
  });

  it("leaves a failed impersonation check unknown, so callers that fail closed keep waiting", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper });
    // The hook retries once (about a second) before reporting the error.
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 3000 });
    expect(result.current.isKnown).toBe(false);
  });

  it("treats signed out as a known answer: nobody is impersonated", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401 });
    const { wrapper } = setup();
    const { result } = renderHook(() => useImpersonationStatus(), { wrapper });
    await waitFor(() => expect(result.current.isKnown).toBe(true));
    expect(result.current.isImpersonating).toBe(false);
  });
});
