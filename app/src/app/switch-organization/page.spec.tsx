import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const params = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => params }));
const fetchMock = jest.fn();
const reload = jest.fn();
jest.mock("@/lib/project-navigation", () => ({ reloadProjectContext: (...a: unknown[]) => reload(...a) }));
jest.mock("@/hooks/use-project-context", () => ({ clearProjectsCache: jest.fn() }));
import { fireEvent } from "@testing-library/react";
import SwitchOrganizationPage from "./page";

const ORG = "0192f7a0-7a3b-7c4d-8e5f-0123456789ab";

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  global.fetch = fetchMock as unknown as typeof fetch;
  for (const key of [...params.keys()]) params.delete(key);
});

it("posts the organization switch once, with the id from the link, and shows a status", async () => {
  params.set("org", ORG);
  render(<SwitchOrganizationPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Returning to your organization");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/organizations/switch", expect.objectContaining({ method: "POST", body: JSON.stringify({ organizationId: ORG }) }));
  // Clears the previous organization's cached data and lands on the organization page.
  await waitFor(() => expect(reload).toHaveBeenCalledWith(expect.any(Function), "/org-admin"));
});

it.each([["missing", null], ["not a uuid", "../../etc"], ["a uuid with a suffix", `${ORG}/x`]])("never posts for a link with %s", async (_label, value) => {
  if (value !== null) params.set("org", value);
  render(<SwitchOrganizationPage />);
  await screen.findByRole("status");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledWith(expect.any(Function), "/org-admin");
});

it.each([["rejected", () => fetchMock.mockRejectedValueOnce(new Error("offline"))], ["refused", () => fetchMock.mockResolvedValueOnce({ ok: false })]])("reports a %s switch and offers a retry instead of landing on another organization", async (_label, fail) => {
  params.set("org", ORG);
  fail();
  render(<SwitchOrganizationPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not switch back");
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(reload).toHaveBeenCalledWith(expect.any(Function), "/org-admin"));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
