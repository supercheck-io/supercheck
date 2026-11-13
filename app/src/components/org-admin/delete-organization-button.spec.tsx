import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteOrganizationButton } from "./delete-organization-button";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const reloadProjectContext = jest.fn();
jest.mock("@/lib/project-navigation", () => ({ reloadProjectContext: (...a: unknown[]) => reloadProjectContext(...a) }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function openDialog() {
  render(<DeleteOrganizationButton organizationId="org-1" organizationName="Acme" />);
  fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
}

it("enables deletion only after the exact name is typed and sends the confirmed id", async () => {
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, error: "Only organization owners can delete organizations" }) });
  openDialog();
  const confirm = screen.getAllByRole("button", { name: "Delete organization" }).at(-1)!;
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "acme" } });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "Acme" } });
  fireEvent.click(confirm);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only organization owners can delete organizations"));
  expect(fetchMock).toHaveBeenCalledWith("/api/organizations/org-1", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmName: "Acme" }) }));
});

it("explains a non-JSON response instead of claiming failure", async () => {
  fetchMock.mockResolvedValueOnce({ json: async () => { throw new SyntaxError("<html>"); } });
  openDialog();
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "Acme" } });
  fireEvent.submit(screen.getByLabelText(/Type the organization name/).closest("form")!);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("may still be running")));
});

it("clears cached project data and reloads after a successful delete, keeping the button disabled", async () => {
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true }) });
  openDialog();
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "Acme" } });
  const confirm = screen.getAllByRole("button", { name: "Delete organization" }).at(-1)!;
  fireEvent.click(confirm);
  await waitFor(() => expect(reloadProjectContext).toHaveBeenCalled());
  expect(confirm).toBeDisabled();
});

it("accepts the name without surrounding whitespace and never an empty confirmation", () => {
  render(<DeleteOrganizationButton organizationId="org-2" organizationName="  Acme Co " />);
  fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
  const confirm = screen.getAllByRole("button", { name: "Delete organization" }).at(-1)!;
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "Acme Co" } });
  expect(confirm).toBeEnabled();
});

it("warns that a dropped connection may have deleted the organization", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  openDialog();
  fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value: "Acme" } });
  fireEvent.submit(screen.getByLabelText(/Type the organization name/).closest("form")!);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("may have gone through")));
});
