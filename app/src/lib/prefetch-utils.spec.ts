import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { prefetchSidebarRoute } from "./prefetch-utils";
import { getDashboardQueryKey, type DashboardData } from "@/hooks/use-dashboard";

jest.mock("@/actions/sre-ai", () => ({ getSreCopilotChatHistories: jest.fn() }));
jest.mock("@/actions/sre-incidents", () => ({ getSreIncidents: jest.fn() }));
jest.mock("@/components/monaco-prefetcher", () => ({ triggerMonacoPreload: jest.fn() }));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
}

describe("dashboard hover prefetch", () => {
  afterEach(() => jest.restoreAllMocks());

  it("warms the normalized dashboard cache with requests bound to each project", async () => {
    const client = createClient();
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const projectId = new Headers(init?.headers).get("x-project-id");
        return {
          ok: true,
          json: async () => ({ jobs: { recentRuns30d: projectId === "dash-prefetch-a" ? 12 : 7 } }),
        } as Response;
      });

    for (const id of ["dash-prefetch-a", "dash-prefetch-b"]) {
      prefetchSidebarRoute("/", id, client);
      // Joining the in-flight query waits for the actual prefetch function.
      await client.fetchQuery({ queryKey: getDashboardQueryKey(id), staleTime: 60_000 });
    }

    expect(client.getQueryData<DashboardData>(getDashboardQueryKey("dash-prefetch-a"))?.stats.runs).toBe(12);
    expect(client.getQueryData<DashboardData>(getDashboardQueryKey("dash-prefetch-b"))?.stats.runs).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const id of ["dash-prefetch-a", "dash-prefetch-b"]) {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/dashboard",
        expect.objectContaining({ headers: expect.objectContaining({ "x-project-id": id }) }),
      );
    }
    client.clear();
  });

  it("ignores a raw dashboard payload persisted under the legacy key", async () => {
    const client = createClient();
    // Before the fix, this is exactly what the hover prefetch stored: the raw
    // /api/dashboard response, merged into the persisted cache under
    // ["dashboard", projectId]. The dashboard then read it as DashboardData and
    // threw on stats.runs, which is the crash this test guards against.
    const legacyClient = new QueryClient();
    legacyClient.setQueryData(["dashboard", "dash-legacy"], {
      jobs: { recentRuns30d: 99, total: 99 },
      monitors: { total: 3 },
    });
    hydrate(client, dehydrate(legacyClient));
    legacyClient.clear();

    jest.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      return {
        ok: true,
        json: async () =>
          String(input).includes("alerts") ? [] : { jobs: { recentRuns30d: 12 } },
      } as Response;
    });

    prefetchSidebarRoute("/", "dash-legacy", client);
    await client.fetchQuery({ queryKey: getDashboardQueryKey("dash-legacy"), staleTime: 60_000 });

    const cached = client.getQueryData<DashboardData>(getDashboardQueryKey("dash-legacy"));
    expect(cached?.stats).toBeDefined();
    expect(cached?.stats.runs).toBe(12);
    client.clear();
  });

  it("leaves failed prefetches retryable instead of caching raw or partial data", async () => {
    const client = createClient();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" } as Response);

    prefetchSidebarRoute("/", "dash-failure", client);

    await expect(
      client.fetchQuery({ queryKey: getDashboardQueryKey("dash-failure") }),
    ).rejects.toThrow();
    expect(client.getQueryData(getDashboardQueryKey("dash-failure"))).toBeUndefined();
    client.clear();
  });
});
