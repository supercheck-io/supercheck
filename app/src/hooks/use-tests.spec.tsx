import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTest } from "./use-tests";
import { useJob } from "./use-jobs";

jest.mock("./use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1" } }) }));

it("keeps a single test (which carries its script) out of the persisted cache, but not other items", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: "x", script: "secret()" }) })) as never;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  renderHook(() => { useTest("t1"); useJob("j1"); }, { wrapper });
  await waitFor(() => expect(client.getQueryCache().find({ queryKey: ["test", "t1"] })?.state.status).toBe("success"));
  expect(client.getQueryCache().find({ queryKey: ["test", "t1"] })?.meta?.persist).toBe(false);
  await waitFor(() => expect(client.getQueryCache().find({ queryKey: ["job", "j1"] })?.state.status).toBe("success"));
  const jobQuery = client.getQueryCache().find({ queryKey: ["job", "j1"] });
  expect(jobQuery).toBeDefined();
  expect(jobQuery!.meta?.persist).toBeUndefined();
  client.clear();
});
