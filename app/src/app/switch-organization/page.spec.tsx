import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const params = new URLSearchParams();
jest.mock("next/navigation", () => ({ useSearchParams: () => params }));
const fetchMock = jest.fn();
import SwitchOrganizationPage from "./page";

const ORG = "0192f7a0-7a3b-7c4d-8e5f-0123456789ab";

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue({ ok: true });
  global.fetch = fetchMock as unknown as typeof fetch;
  // jsdom cannot navigate: it reports the replace as a console error, which is the navigation signal here.
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  for (const key of [...params.keys()]) params.delete(key);
});

it("posts the organization switch once, with the id from the link, and shows a status", async () => {
  params.set("org", ORG);
  render(<SwitchOrganizationPage />);
  expect(screen.getByRole("status")).toHaveTextContent("Returning to your organization");
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledWith("/api/organizations/switch", expect.objectContaining({ method: "POST", body: JSON.stringify({ organizationId: ORG }) }));
});

it.each([["missing", null], ["not a uuid", "../../etc"], ["a uuid with a suffix", `${ORG}/x`]])("never posts for a link with %s", async (_label, value) => {
  if (value !== null) params.set("org", value);
  render(<SwitchOrganizationPage />);
  await screen.findByRole("status");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("still returns to the organization page when the switch request fails", async () => {
  params.set("org", ORG);
  fetchMock.mockRejectedValue(new Error("offline"));
  render(<SwitchOrganizationPage />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(console.error).toHaveBeenCalled());
});
