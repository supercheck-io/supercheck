import { Suspense, useEffect } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { dehydrate, IsRestoringProvider, QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { DataPrefetcher } from "@/components/data-prefetcher";
import { useAlertHistory, useNotificationProviders } from "@/hooks/use-alerts";
import { clearQueryCache, QueryProvider } from "./query-provider";

let mockIsServer = false;
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  get isServer() { return mockIsServer; },
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ currentProject: { id: "project-1" }, loading: false }),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/" }));

const CACHE_KEY = "supercheck-cache-v1";
const fetchMock = jest.fn();
let mountedClient: QueryClient;

function AlertsProbe() {
  const client = useQueryClient();
  useEffect(() => { mountedClient = client; }, [client]);
  const history = useAlertHistory();
  const channels = useNotificationProviders();
  return (
    <div>
      {(history.isLoading && history.alertHistory.length === 0) || (channels.isLoading && channels.providers.length === 0)
        ? "Loading alerts..."
        : `Alerts: ${history.alertHistory.length}; channels: ${channels.providers.length}`}
    </div>
  );
}

function seedCache() {
  const client = new QueryClient();
  client.setQueryData(["alerts-history", "project-1"], [{ id: "saved-alert" }]);
  client.setQueryData(["notification-providers", "project-1"], [{ id: "saved-channel" }]);
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    timestamp: Date.now(), buster: "", clientState: dehydrate(client),
  }));
  client.clear();
}

describe("QueryProvider hydration", () => {
  beforeEach(() => {
    mockIsServer = false;
    clearQueryCache();
    localStorage.clear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: "current-result" }] });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    cleanup();
    clearQueryCache();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it.each([true, false])("hydrates consistently with saved cache = %s", async (hasCache) => {
    if (hasCache) seedCache();
    let finishFetch!: () => void;
    const network = new Promise((resolve) => {
      finishFetch = () => resolve({ ok: true, json: async () => [{ id: "current-result" }] });
    });
    fetchMock.mockReturnValue(network);
    const readCache = jest.spyOn(Storage.prototype, "getItem");
    const recoverableError = jest.fn();
    const tree = <QueryProvider><Suspense><AlertsProbe /></Suspense></QueryProvider>;
    mockIsServer = true;
    const html = renderToString(tree);
    expect(html).toContain("Loading alerts...");

    mockIsServer = false;
    // The shared provider can render before a streamed child hydrates.
    renderToString(<QueryProvider><span>Shell</span></QueryProvider>);
    await Promise.resolve();
    await Promise.resolve();
    expect(readCache).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError: recoverableError });
      });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(container.textContent).toBe(hasCache ? "Alerts: 1; channels: 1" : "Loading alerts...");
      await act(async () => finishFetch());
      await waitFor(() => expect(container.textContent).toBe("Alerts: 1; channels: 1"));
      expect(readCache).toHaveBeenCalledWith(CACHE_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(recoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it("preserves persistence opt-outs and clears the cache at identity changes", async () => {
    render(<QueryProvider><AlertsProbe /></QueryProvider>);
    await screen.findByText("Alerts: 1; channels: 1");
    act(() => {
      mountedClient.setQueryDefaults(["private"], { meta: { persist: false } });
      mountedClient.setQueryData(["private"], "sensitive-result");
      mountedClient.setQueryData(["public"], "saved-result");
    });
    await waitFor(() => expect(localStorage.getItem(CACHE_KEY)).toContain("saved-result"));
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY)!);
    expect(saved.clientState.queries.map((query: { queryKey: string[] }) => query.queryKey))
      .toContainEqual(["public"]);
    expect(saved.clientState.queries.map((query: { queryKey: string[] }) => query.queryKey))
      .not.toContainEqual(["private"]);
    jest.useFakeTimers();
    act(() => {
      mountedClient.setQueryData(["public"], "queued-result");
      clearQueryCache();
      jest.advanceTimersByTime(500);
    });
    expect(mountedClient.getQueryCache().getAll()).toHaveLength(0);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("waits for restoration before prefetching layout data", () => {
    const client = new QueryClient();
    const prefetch = jest.spyOn(client, "prefetchQuery").mockResolvedValue(undefined);
    const tree = (isRestoring: boolean) => (
      <QueryClientProvider client={client}>
        <IsRestoringProvider value={isRestoring}><DataPrefetcher /></IsRestoringProvider>
      </QueryClientProvider>
    );
    const view = render(tree(true));
    expect(prefetch).not.toHaveBeenCalled();
    view.rerender(tree(false));
    expect(prefetch).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["notification-providers", "project-1"],
    }));
    const calls = prefetch.mock.calls.length;
    view.rerender(tree(false));
    expect(prefetch).toHaveBeenCalledTimes(calls);
    client.clear();
  });
});
