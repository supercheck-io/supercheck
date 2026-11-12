import React from "react";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteOrganizationButton } from "./delete-organization-button";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
const signOut = jest.fn();
jest.mock("@/utils/auth-client", () => ({ signOut: (...a: unknown[]) => { signOut(...a); return Promise.resolve(); } }));
const fetchMock = jest.fn();

const info = (over: Record<string, unknown> = {}) => ({ json: async () => ({ deletion: { graceDays: 14, emailAvailable: true, hasSubscription: true, pending: false, ...over } }) });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

async function openDialog(name = "Acme") {
  render(<DeleteOrganizationButton organizationId="org-1" organizationName={name} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete organization" }));
  // The request button stays disabled until the deletion settings have loaded: let that settle.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const confirmButton = () => screen.getByRole("button", { name: "Request deletion" });
const typeName = (value: string) => fireEvent.change(screen.getByLabelText(/Type the organization name/), { target: { value } });

it("explains the window and enables the request only after the exact name is typed", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, error: "Only organization owners can delete organizations" }) });
  await openDialog();
  expect(await screen.findByText(/read-only for 14 days/)).toBeTruthy();
  typeName("acme");
  expect(confirmButton()).toBeDisabled();
  typeName("Acme");
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only organization owners can delete organizations"));
  expect(fetchMock).toHaveBeenCalledWith("/api/organizations/org-1", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirmName: "Acme" }) }));
});

it("never accepts an empty confirmation and trims the name", async () => {
  fetchMock.mockResolvedValue(info());
  await openDialog("  Acme Co ");
  expect(confirmButton()).toBeDisabled();
  typeName("Acme Co");
  expect(confirmButton()).toBeEnabled();
});

it("sends the user through sign-in again when fresh authentication is required", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: false, code: "REAUTH_REQUIRED" }) });
  await openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("Sign in again to continue")).toBeTruthy();
  expect(toast.error).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
  await waitFor(() => expect(signOut).toHaveBeenCalled());
});

it("sends the owner back through the organization switch after signing in again", async () => {
  const { sanitizeNextPath } = jest.requireActual("@/lib/auth/safe-next-path") as typeof import("@/lib/auth/safe-next-path");
  const next = encodeURIComponent("/switch-organization?org=01a1cc16-a6e5-7685-aaf1-5a7a3f714c3c");
  expect(sanitizeNextPath(next)).toBe("/switch-organization?org=01a1cc16-a6e5-7685-aaf1-5a7a3f714c3c");
  expect(sanitizeNextPath(encodeURIComponent("/switch-organization?org=../../evil"))).toBeNull();
});

it("confirms by email after a successful request", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, purgeAfter: "2030-01-15T00:00:00.000Z" }) });
  await openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("We emailed the organization owners")).toBeTruthy();
});

it("shows in-app confirmation when the server cannot send email", async () => {
  fetchMock.mockResolvedValueOnce(info({ emailAvailable: false }));
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, purgeAfter: "2030-01-15T00:00:00.000Z" }) });
  await openDialog();
  expect(await screen.findByText(/No email is sent/)).toBeTruthy();
  typeName("Acme");
  fireEvent.click(confirmButton());
  expect(await screen.findByText("Confirmed. No email was sent")).toBeTruthy();
  expect(screen.queryByText(/We emailed/)).toBeNull();
});

it("warns about a non-JSON response and a dropped connection", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => { throw new SyntaxError("<html>"); } });
  await openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("No response")));
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Lost contact")));
});

it("does not claim an email went out when the organization was already scheduled", async () => {
  fetchMock.mockResolvedValueOnce(info());
  fetchMock.mockResolvedValueOnce({ json: async () => ({ success: true, status: "already", purgeAfter: "2030-01-01T00:00:00Z" }) });
  jest.spyOn(console, "error").mockImplementation(() => undefined); // jsdom has no page reload
  await openDialog();
  typeName("Acme");
  fireEvent.click(confirmButton());
  await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("already scheduled")));
  expect(screen.queryByText("We emailed the organization owners")).toBeNull();
});

it("keeps the request disabled and offers a retry while the deletion settings cannot be loaded", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(info({ graceDays: 0 }));
  await openDialog();
  typeName("Acme");
  expect(screen.getByText(/Could not load the deletion settings/)).toBeTruthy();
  expect(confirmButton()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(confirmButton()).toBeEnabled());
});
