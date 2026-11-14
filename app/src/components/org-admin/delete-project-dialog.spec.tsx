import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteProjectDialog } from "./delete-project-dialog";

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
