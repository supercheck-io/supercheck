import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useJobMutations, invalidateJobCaches, JOBS_QUERY_KEY } from "./use-jobs";
import { DASHBOARD_QUERY_KEY } from "./use-dashboard";

jest.mock("./use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1" } }) }));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const spy = jest.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, spy, wrapper };
}
const invalidated = (spy: jest.SpyInstance) => spy.mock.calls.map(([f]) => (f as { queryKey: readonly string[] }).queryKey);

beforeEach(() => { global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })) as never; });

it("deleting a job also invalidates the dashboard", async () => {
  const { spy, wrapper } = setup();
  const { result } = renderHook(() => useJobMutations(), { wrapper });
  await act(async () => { await result.current.deleteJob.mutateAsync("j1"); });
  expect(invalidated(spy)).toEqual(expect.arrayContaining([JOBS_QUERY_KEY, DASHBOARD_QUERY_KEY]));
});

it("updating a job also invalidates the dashboard", async () => {
  const { spy, wrapper } = setup();
  const { result } = renderHook(() => useJobMutations(), { wrapper });
  await act(async () => { await result.current.updateJob.mutateAsync({ id: "j1", name: "n" }); });
  expect(invalidated(spy)).toEqual(expect.arrayContaining([DASHBOARD_QUERY_KEY]));
});

it("invalidateJobCaches evicts the deleted job's detail query", () => {
  const { client } = setup();
  client.setQueryData(["job", "j1"], { id: "j1" });
  client.setQueryData(["job", "j2"], { id: "j2" });
  invalidateJobCaches(client, "j1");
  expect(client.getQueryData(["job", "j1"])).toBeUndefined();
  expect(client.getQueryData(["job", "j2"])).toBeDefined();
});

it("invalidateJobCaches refreshes jobs and dashboard", () => {
  const { client, spy } = setup();
  invalidateJobCaches(client);
  expect(invalidated(spy)).toEqual([JOBS_QUERY_KEY, DASHBOARD_QUERY_KEY]);
});
