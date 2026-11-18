import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ADMIN_LOCATIONS_QUERY_KEY, useCreateLocation, useDeleteLocation, useUpdateLocation } from "./use-locations";

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

it("treats a 2xx with an empty body as deleted, and refreshes the list after a failure too", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 204, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } })) as never;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useDeleteLocation(), { wrapper });
  await act(async () => { await result.current.mutateAsync("loc-1"); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_LOCATIONS_QUERY_KEY });

  invalidate.mockClear();
  global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => null })) as never;
  await act(async () => { await expect(result.current.mutateAsync("loc-1")).rejects.toThrow("HTTP 502"); });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ADMIN_LOCATIONS_QUERY_KEY });
  client.clear();
});

it("reports create and update failures with their status when the error body is an HTML page", async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } })) as never;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const create = renderHook(() => useCreateLocation(), { wrapper }).result;
  const update = renderHook(() => useUpdateLocation(), { wrapper }).result;
  await act(async () => {
    await expect(create.current.mutateAsync({ code: "x", name: "X" } as never)).rejects.toThrow("Failed to create location (HTTP 502)");
    await expect(update.current.mutateAsync({ id: "loc-1", name: "X" })).rejects.toThrow("Failed to update location (HTTP 502)");
  });
  client.clear();
});
