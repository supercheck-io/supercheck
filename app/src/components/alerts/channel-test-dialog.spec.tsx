import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ChannelTestDialog, sendChannelTest } from "./channel-test-dialog";
import type { NotificationChannel } from "./notification-channels-schema";

const channel = (over: Partial<NotificationChannel> = {}): NotificationChannel => ({
  id: "ch-1",
  name: "PagerDuty prod",
  type: "webhook",
  config: { preset: "pagerduty" },
  isEnabled: true,
  createdAt: "2026-11-14T00:00:00Z",
  ...over,
});

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  global.fetch = jest.fn();
});

it("sends a test page on open and shows what the vendor answered", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    reply(200, { ok: true, action: "trigger", responseStatus: 202, responseStatusText: "Accepted", responseExcerpt: '{"status":"success"}', elapsedMs: 120, dedupKey: "test:ch-1" }),
  );
  render(<ChannelTestDialog channel={channel()} onOpenChange={jest.fn()} />);
  expect(await screen.findByText("HTTP 202 Accepted")).toBeInTheDocument();
  expect(screen.getByTestId("channel-test-status")).toHaveTextContent("Delivered");
  expect(screen.getByText("test:ch-1")).toBeInTheDocument();
  expect(screen.getByText("120 ms")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith("/api/notification-providers/ch-1/test", expect.objectContaining({ method: "POST", body: JSON.stringify({ action: "trigger" }) }));
});

it("resolves the test page for a paging preset", async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(reply(200, { ok: true, action: "trigger", responseStatus: 202, dedupKey: "test:ch-1" }))
    .mockResolvedValueOnce(reply(200, { ok: true, action: "resolve", responseStatus: 202, dedupKey: "test:ch-1" }));
  render(<ChannelTestDialog channel={channel()} onOpenChange={jest.fn()} />);
  const resolve = await screen.findByRole("button", { name: "Resolve test page" });
  await waitFor(() => expect(resolve).toBeEnabled());
  fireEvent.click(resolve);
  await waitFor(() => expect(screen.getByTestId("channel-test-status")).toHaveTextContent("Resolved"));
  expect((global.fetch as jest.Mock).mock.calls[1][1].body).toBe(JSON.stringify({ action: "resolve" }));
});

it("shows the integration key hint on 401 and no resolve button for chat channels", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(
    reply(200, { ok: false, action: "trigger", responseStatus: 401, error: "Authentication rejected (HTTP 401). Check the integration key." }),
  );
  const { rerender } = render(<ChannelTestDialog channel={channel()} onOpenChange={jest.fn()} />);
  expect(await screen.findByTestId("channel-test-error")).toHaveTextContent("Check the integration key");
  expect(screen.getByTestId("channel-test-status")).toHaveTextContent("Failed");

  (global.fetch as jest.Mock).mockResolvedValueOnce(reply(200, { ok: true, action: "trigger", message: "Slack connection successful" }));
  rerender(<ChannelTestDialog channel={channel({ id: "ch-2", name: "Ops", type: "slack", config: {} })} onOpenChange={jest.fn()} />);
  expect(await screen.findByText("Slack connection successful")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Resolve test page" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading")).toHaveTextContent("Test message: Ops");
});

it("reports a denied or rate-limited request as a failure", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(reply(429, { error: "Too many connection tests. Try again later." }));
  expect(await sendChannelTest("ch-1", "trigger")).toEqual({ ok: false, action: "trigger", error: "Too many connection tests. Try again later." });
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error("no body"); } });
  expect(await sendChannelTest("ch-1", "resolve")).toEqual({ ok: false, action: "resolve", error: "Request failed (HTTP 500)" });
});

it("shows a failure when the request throws", async () => {
  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error("offline"));
  render(<ChannelTestDialog channel={channel()} onOpenChange={jest.fn()} />);
  expect(await screen.findByText("The test could not be sent")).toBeInTheDocument();
});

it("keeps the page resolvable after a failed resolve, so it can be retried", async () => {
  (global.fetch as jest.Mock)
    .mockResolvedValueOnce(reply(200, { ok: true, action: "trigger", responseStatus: 202 }))
    .mockResolvedValueOnce(reply(200, { ok: false, action: "resolve", responseStatus: 503 }))
    .mockResolvedValueOnce(reply(200, { ok: true, action: "resolve", responseStatus: 202 }));
  render(<ChannelTestDialog channel={channel()} onOpenChange={jest.fn()} />);
  const resolve = await screen.findByRole("button", { name: "Resolve test page" });
  await waitFor(() => expect(resolve).toBeEnabled());
  fireEvent.click(resolve);
  await waitFor(() => expect(screen.getByTestId("channel-test-status")).toHaveTextContent("Failed"));
  expect(resolve).toBeEnabled();
  fireEvent.click(resolve);
  await waitFor(() => expect(screen.getByTestId("channel-test-status")).toHaveTextContent("Resolved"));
  expect(resolve).toBeDisabled();
});

it("drops a result that arrives after the dialog moved to another channel", async () => {
  let finishFirst: (value: unknown) => void = () => undefined;
  (global.fetch as jest.Mock)
    .mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; }))
    .mockResolvedValueOnce(reply(200, { ok: true, action: "trigger", responseStatus: 202, responseStatusText: "From B" }));
  const { rerender } = render(<ChannelTestDialog channel={channel({ id: "ch-a" })} onOpenChange={jest.fn()} />);
  rerender(<ChannelTestDialog channel={channel({ id: "ch-b" })} onOpenChange={jest.fn()} />);
  expect(await screen.findByText("HTTP 202 From B")).toBeInTheDocument();
  finishFirst(reply(200, { ok: false, action: "trigger", responseStatus: 500, responseStatusText: "From A" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText(/From A/)).not.toBeInTheDocument();
  expect(screen.getByText("HTTP 202 From B")).toBeInTheDocument();
});
