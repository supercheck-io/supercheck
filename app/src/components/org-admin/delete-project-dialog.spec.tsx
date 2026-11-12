import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { DeletedProjects } from "./deleted-projects";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("deletes only after the exact project name is typed", async () => {
  const onDeleted = jest.fn();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  render(<DeleteProjectDialog project={{ id: "p1", name: "Web App" }} onOpenChange={jest.fn()} onDeleted={onDeleted} />);
  const button = screen.getByRole("button", { name: "Delete project" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type the project name/), { target: { value: "web app" } });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type the project name/), { target: { value: "Web App" } });
  fireEvent.click(button);
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1", { method: "DELETE" });
});

it("shows the server error and keeps the dialog open", async () => {
  const onDeleted = jest.fn();
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Cannot delete the default project" }) });
  render(<DeleteProjectDialog project={{ id: "p1", name: "Web" }} onOpenChange={jest.fn()} onDeleted={onDeleted} />);
  fireEvent.change(screen.getByLabelText(/Type the project name/), { target: { value: "Web" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot delete the default project"));
  expect(onDeleted).not.toHaveBeenCalled();
});

it("lists deleted projects and restores one", async () => {
  const onRestored = jest.fn();
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [{ id: "p1", name: "Old", deletedAt: null, purgeAfter: "2030-01-01T00:00:00Z" }] }) });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ projects: [] }) });
  render(<QueryClientProvider client={new QueryClient()}><DeletedProjects onRestored={onRestored} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Restore/ }));
  await waitFor(() => expect(onRestored).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/restore", { method: "POST" });
});

it("renders nothing when the list is empty or forbidden", async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Insufficient permissions" }) });
  const { container } = render(<QueryClientProvider client={new QueryClient()}><DeletedProjects onRestored={jest.fn()} /></QueryClientProvider>);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
