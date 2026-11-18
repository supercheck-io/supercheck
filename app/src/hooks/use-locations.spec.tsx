import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useDeleteLocation } from "./use-locations";

it("reports a failed delete with its status when the error body is not JSON", async () => {
  global.fetch = jest.fn(async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new SyntaxError("Unexpected token <"); },
  })) as never;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useDeleteLocation(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync("loc-1")).rejects.toThrow("Failed to delete location (HTTP 502)");
  });
  client.clear();
});

it("reports the status when the error body is JSON null", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => null })) as never;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useDeleteLocation(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync("loc-1")).rejects.toThrow("Failed to delete location (HTTP 502)");
  });
  client.clear();
});
