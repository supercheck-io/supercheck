import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useJob } from "../use-jobs";

jest.mock("../use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1" } }) }));

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  // A copy cached on an earlier visit; a teammate has since renamed the job.
  client.setQueryData(["job", "j1"], { id: "j1", name: "old name" });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ job: { id: "j1", name: "new name" } }) })) as never;
  return { client, wrapper };
}

it("fresh: reports loading over a cached copy until this mount's fetch returns, then gives current data", async () => {
  const { client, wrapper } = setup();
  const { result } = renderHook(() => useJob("j1", { fresh: true }), { wrapper });
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.data).toMatchObject({ name: "new name" });
  client.clear();
});

it("without fresh, serves the cached copy and does not refetch on mount", () => {
  const { client, wrapper } = setup();
  const { result } = renderHook(() => useJob("j1"), { wrapper });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.data).toMatchObject({ name: "old name" });
  expect(global.fetch).not.toHaveBeenCalled();
  client.clear();
});
