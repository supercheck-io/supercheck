import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteOrganizationButton } from "./delete-organization-button";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
const signOut = jest.fn();
jest.mock("@/utils/auth-client", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));
const fetchMock = jest.fn();

const info = (over: Record<string, unknown> = {}) => ({ json: async () => ({ deletion: { graceDays: 14, emailAvailable: true, hasSubscription: true, pending: false, ...over } }) });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

function openDialog(name = "Acme") {
  render(<DeleteOrganizationButton organizationId="org-1" organizationName={name} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
}
const confirmButton = () => screen.getByRole("button", { name: "Request deletion" });
const typeName = (value: string) => fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value } });

it("explains the window and enables the request only after the exact name is typed", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, error: "Only organization owners can delete organizations" }) });
  openDialog();
  expect(await screen.findByText(/read-only for 14 days/)).toBeTruthy();
  typeName("acme");
  expect(confirmButton()).toBeDisabled();
  typeName("Acme");
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only organization owners can delete organizations"));
  expect(fetchMock).toHaveBeenCalledWith("/api/organizations/org-1", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmName: "Acme" }) }));
});

it("never accepts an empty confirmation and trims the name", () => {
  fetchMock.mockResolvedValue(info());
  openDialog("  Acme Co ");
  expect(confirmButton()).toBeDisabled();
  typeName("Acme Co");
  expect(confirmButton()).toBeEnabled();
});

it("sends the user through sign-in again when fresh authentication is required", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, code: "REAUTH_REQUIRED" }) });
  openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("Sign in again to continue")).toBeTruthy();
  expect(toast.error).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
});

it("confirms by email after a successful request", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, purgeAfter: "2030-01-15T00:00:00.000Z" }) });
  openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("We emailed the organization owners")).toBeTruthy();
});

it("shows in-app confirmation when the server cannot send email", async () => {
  fetchMock.mockResolvedValueOnce(info({ emailAvailable: false }));
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, purgeAfter: "2030-01-15T00:00:00.000Z" }) });
  openDialog();
  expect(await screen.findByText(/No email is sent/)).toBeTruthy();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("Confirmed. No email was sent")).toBeTruthy();
  expect(screen.queryByText(/We emailed/)).toBeNull();
});

it("warns about a non-JSON response and a dropped connection", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => { throw new SyntaxError("<html>"); } });
  openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No response")));
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Lost contact")));
});
