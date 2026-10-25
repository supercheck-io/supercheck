import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { prefetchSidebarRoute } from "./prefetch-utils";
import { getDashboardQueryKey, type DashboardData } from "@/hooks/use-dashboard";

jest.mock("@/actions/sre-evidence-graph", () => ({ getSreEvidenceGraphAction: jest.fn() }));
jest.mock("@/actions/sre-ai", () => ({ getSreCopilotChatHistories: jest.fn() }));
jest.mock("@/actions/sre-incidents", () => ({ getSreIncidents: jest.fn() }));
jest.mock("@/components/monaco-prefetcher", () => ({ triggerMonacoPreload: jest.fn() }));

describe("dashboard hover prefetch", () => {
  afterEach(() => jest.restoreAllMocks());

  it("warms the normalized dashboard cache with requests bound to each project", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const projectId = new Headers(init?.headers).get("x-project-id");
      return { ok: true, json: async () => String(url).includes("alerts") ? [] : {
        jobs: { recentRuns30d: projectId === "prefetch-a" ? 12 : 7 },
      } } as Response;
    });
    for (const id of ["prefetch-a", "prefetch-b"]) {
      const oldClient = new QueryClient();
      oldClient.setQueryData(["dashboard", id], { jobs: { recentRuns30d: 99 } });
      hydrate(client, dehydrate(oldClient));
      oldClient.clear();
      prefetchSidebarRoute("/", id, client);
      // Joining the in-flight query waits for the actual prefetch function.
      await client.fetchQuery({ queryKey: getDashboardQueryKey(id), staleTime: 60_000 });
    }
    expect(client.getQueryData<DashboardData>(getDashboardQueryKey("prefetch-a"))?.stats.runs).toBe(12);
    expect(client.getQueryData<DashboardData>(getDashboardQueryKey("prefetch-b"))?.stats.runs).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const id of ["prefetch-a", "prefetch-b"]) {
      for (const endpoint of ["/api/dashboard", "/api/alerts/history"]) {
        expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
          headers: expect.objectContaining({ "x-project-id": id }),
        }));
      }
    }
    client.clear();
  });

  it("leaves failed prefetches retryable instead of caching raw or partial data", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" } as Response);
    prefetchSidebarRoute("/", "prefetch-failure", client);
    await expect(client.fetchQuery({ queryKey: getDashboardQueryKey("prefetch-failure") })).rejects.toThrow();
    expect(client.getQueryData(getDashboardQueryKey("prefetch-failure"))).toBeUndefined();
    client.clear();
  });
});
