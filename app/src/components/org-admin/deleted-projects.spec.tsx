import React from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { useDeletedProjects } from "./deleted-projects";
import { ProjectsTable } from "./projects-table";
import type { Project } from "./project-columns";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const fetchMock = jest.fn();

const day = 86_400_000;
const project = (id: string, name: string, offsetMs: number | null) => ({ id, name, deletedAt: new Date().toISOString(), purgeAfter: offsetMs === null ? null : new Date(Date.now() + offsetMs).toISOString() });
const list = (projects: unknown[], status = 200) => ({ ok: status < 400, status, json: async () => ({ projects }) });

const active: Project = { id: "live", name: "Live", membersCount: 2, createdAt: "2026-01-01T00:00:00Z", isDefault: true };

/** The org-admin wiring: deleted rows appended to the projects table, the page showing the load error. */
function Harness({ onRestored }: { onRestored: () => void }) {
  const deleted = useDeletedProjects({ enabled: true, onRestored });
  return (
    <>
      <ProjectsTable projects={[active, ...deleted.rows]} onCreateProject={jest.fn()} onRestoreProject={(p) => void deleted.restore(p)} restoringIds={deleted.restoring} canManageProject />
      {deleted.isError && (
        <p role="alert">Could not load recently deleted projects. <button type="button" onClick={() => void deleted.refetch()}>Retry</button></p>
      )}
    </>
  );
}

function renderList(onRestored = jest.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness onRestored={onRestored} />
    </QueryClientProvider>,
  );
  return onRestored;
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("adds no rows when there are no deleted projects, or for a 403", async () => {
  fetchMock.mockResolvedValueOnce(list([]));
  renderList();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/projects/deleted"));
  expect(await screen.findByText("Live")).toBeTruthy();
  expect(screen.queryByText("Deleted")).toBeNull();
});

it("shows a deleted project as a row with a Deleted badge and Restore in place of the actions menu", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  renderList();
  expect(await screen.findByText("Alpha")).toBeTruthy();
  expect(screen.getByText("Deleted")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Restore Alpha" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open actions for Alpha" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open actions for Live" })).toBeTruthy();
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

it("shows an error with a retry when the list cannot be loaded", async () => {
  fetchMock.mockResolvedValueOnce(list([], 500)).mockResolvedValueOnce(list([project("p1", "Alpha", 3 * day)]));
  renderList();
  expect(await screen.findByText(/Could not load recently deleted projects/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Alpha")).toBeTruthy();
});

it("drops a project whose restore window ends while the page stays open", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockResolvedValue(list([project("p1", "Alpha", 20_000)]));
    renderList();
    expect(await screen.findByText("Alpha")).toBeTruthy();
    await act(async () => { jest.advanceTimersByTime(60_000); });
    expect(screen.queryByText("Alpha")).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it("keeps every restore in flight disabled until its own request finishes", async () => {
  let finishA: (v: unknown) => void = () => undefined;
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day), project("b", "Beta", 3 * day)]));
  fetchMock.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; }));
  fetchMock.mockReturnValueOnce(new Promise(() => undefined)); // Beta never answers
  renderList();
  const alpha = () => screen.getByRole("button", { name: "Restore Alpha" }); // cells re-render, so always re-query
  fireEvent.click(await screen.findByRole("button", { name: "Restore Alpha" }));
  fireEvent.click(screen.getByRole("button", { name: "Restore Beta" }));
  fireEvent.click(alpha()); // a second click on a pending restore sends nothing
  expect(alpha()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Restore Beta" })).toBeDisabled();
  fetchMock.mockResolvedValue(list([project("a", "Alpha", 3 * day), project("b", "Beta", 3 * day)]));
  await act(async () => finishA({ ok: true, json: async () => ({ success: true }) }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Restore Alpha" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Restore Beta" })).toBeDisabled();
  expect(fetchMock.mock.calls.filter(([url]) => url === "/api/projects/a/restore")).toHaveLength(1);
});

it("shows the restore deadline with its time", async () => {
  fetchMock.mockResolvedValueOnce(list([project("a", "Alpha", 3 * day)]));
  renderList();
  expect((await screen.findByRole("button", { name: "Restore Alpha" })).getAttribute("title")).toMatch(/^Restorable until .*\d{1,2}:\d{2}/);
});
