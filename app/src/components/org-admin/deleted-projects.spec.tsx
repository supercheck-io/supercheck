import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { DeletedProjects } from "./deleted-projects";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const fetchMock = jest.fn();

const day = 86_400_000;
const project = (id: string, name: string, offsetMs: number | null) => ({ id, name, deletedAt: new Date().toISOString(), purgeAfter: offsetMs === null ? null : new Date(Date.now() + offsetMs).toISOString() });
const list = (projects: unknown[], status = 200) => ({ ok: status < 400, status, json: async () => ({ projects }) });

function renderList(onRestored = jest.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DeletedProjects onRestored={onRestored} />
    </QueryClientProvider>,
  );
  return onRestored;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("renders nothing when there are no deleted projects", async () => {
  fetchMock.mockResolvedValueOnce(list([]));
  renderList();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/deleted"));
  expect(screen.queryByLabelText("Recently deleted projects")).toBeNull();
});

it("renders nothing for a 403", async () => {
  fetchMock.mockResolvedValueOnce(list([], 403));
  renderList();
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByLabelText("Recently deleted projects")).toBeNull();
});

it("lists restorable projects and hides ones whose window has ended", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day), project("b", "Expired", -day), project("c", "No date", null)]));
  renderList();
  expect(await screen.findByText("Alpha")).toBeTruthy();
  expect(screen.getByText("No date")).toBeTruthy();
  expect(screen.queryByText("Expired")).toBeNull();
});

it("restores a project, tells the user and notifies the page", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  fetchMock.mockResolvedValueOnce(list([]));
  const onRestored = renderList();
  fireEvent.click(await screen.findByRole("button", { name: "Restore Alpha" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Restored Alpha"));
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/a/restore", { method: "POST" });
  expect(onRestored).toHaveBeenCalledTimes(1);
});

it("shows the server's reason when the restore is refused", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "The restore window has ended" }) });
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  const onRestored = renderList();
  fireEvent.click(await screen.findByRole("button", { name: "Restore Alpha" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The restore window has ended"));
  expect(onRestored).not.toHaveBeenCalled();
});

it("reports a network failure while restoring", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  renderList();
  fireEvent.click(await screen.findByRole("button", { name: "Restore Alpha" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Failed to restore project"));
});
