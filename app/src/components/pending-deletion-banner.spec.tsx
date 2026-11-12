import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { PendingDeletionBanner, deletionCountdown } from "./pending-deletion-banner";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const fetchMock = jest.fn();
const future = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();

function renderBanner(props: { pending: boolean; isOwner: boolean }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PendingDeletionBanner organizationId="org-1" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ deletion: { pending: true, purgeAfter: future, canCancel: true } }) });
});

it("renders nothing for an active organization", () => {
  const { container } = renderBanner({ pending: false, isOwner: true });
  expect(container).toBeEmptyDOMElement();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("shows the countdown and a cancel button to the owner only", async () => {
  renderBanner({ pending: true, isOwner: true });
  expect(await screen.findByText(/in 5 days/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel deletion" })).toBeTruthy();
});

it("explains the read-only state to other members without a cancel button", async () => {
  renderBanner({ pending: true, isOwner: false });
  expect(await screen.findByText(/Only an owner can cancel/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancel deletion" })).toBeNull();
});

it("asks for confirmation before cancelling", async () => {
  renderBanner({ pending: true, isOwner: true });
  await screen.findByText(/in 5 days/);
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Purge already started", code: "PURGE_STARTED" }) });
  fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getAllByRole("button", { name: "Cancel deletion" }).at(-1)!);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Purge already started"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/organizations/org-1/cancel-deletion", { method: "POST" });
});

it("formats the countdown", () => {
  const now = Date.now();
  expect(deletionCountdown(new Date(now + 3 * 3_600_000 + 5000).toISOString(), now)).toBe("in 3 hours");
  expect(deletionCountdown(new Date(now - 1).toISOString(), now)).toBe("shortly");
  expect(deletionCountdown(null)).toBe("soon");
});
