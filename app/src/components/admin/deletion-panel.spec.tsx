import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DeletionPanel } from "./deletion-panel";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const fetchMock = jest.fn();
const ID = "11111111-1111-4111-8111-111111111111";
const orgs = [
  { id: ID, name: "Acme", slug: "acme", createdAt: "", deletionRequestedAt: "2030-01-01T00:00:00Z", deletionPurgeAfter: "2030-01-15T00:00:00Z" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Active Co", slug: "a", createdAt: "" },
];

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("lists only pending organizations", () => {
  render(<QueryClientProvider client={new QueryClient()}><DeletionPanel organizations={orgs} onChanged={jest.fn()} /></QueryClientProvider>);
  expect(screen.getByText("Acme")).toBeTruthy();
  expect(screen.queryByText("Active Co")).toBeNull();
});

it("reports loading and a failed organization load instead of an empty list", () => {
  const onRetry = jest.fn();
  const { rerender } = render(<QueryClientProvider client={new QueryClient()}><DeletionPanel organizations={[]} isLoading onChanged={jest.fn()} /></QueryClientProvider>);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  expect(screen.queryByText("None.")).toBeNull();
  rerender(<QueryClientProvider client={new QueryClient()}><DeletionPanel organizations={[]} error={new Error("x")} onRetry={onRetry} onChanged={jest.fn()} /></QueryClientProvider>);
  expect(screen.getByRole("alert").textContent).toContain("Could not load organizations");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalled();
});

it("requires a reason and the organization id before purging", async () => {
  const onChanged = jest.fn();
  render(<QueryClientProvider client={new QueryClient()}><DeletionPanel organizations={orgs} onChanged={onChanged} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Purge Acme now" }));
  const go = screen.getByRole("button", { name: "Purge organization" });
  expect(go).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "too short" } });
  fireEvent.change(screen.getByLabelText(/organization ID/), { target: { value: ID } });
  expect(go).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Legal erasure request 1234" } });
  expect(go).toBeEnabled();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, data: {} }) });
  fireEvent.click(go);
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/organizations/${ID}/purge`, expect.objectContaining({ body: JSON.stringify({ reason: "Legal erasure request 1234", confirmOrganizationId: ID }) }));
});
