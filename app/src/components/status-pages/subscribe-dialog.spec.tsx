import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubscribeDialog } from "./subscribe-dialog";
import { subscribeToStatusPage } from "@/actions/subscribe-to-status-page";

jest.mock("@/actions/subscribe-to-status-page", () => ({ subscribeToStatusPage: jest.fn() }));
const props = { statusPageId: "00000000-0000-0000-0000-000000000123", statusPageName: "Status", allowEmailSubscribers: true, allowSlackSubscribers: false, allowWebhookSubscribers: false, allowRssFeed: false, allowIncidentSubscribers: false };

it("renders only enabled channels and submits ordinary subscriptions when incident targeting is disabled", async () => {
  jest.mocked(subscribeToStatusPage).mockResolvedValue({ success: true, message: "Check email" });
  render(<SubscribeDialog {...props} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("tab", { name: /email/i })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /slack/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /webhook/i })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
  await waitFor(() => expect(subscribeToStatusPage).toHaveBeenCalledWith(expect.objectContaining({ subscriptionMode: "email", subscribeToAllIncidents: false })));
});

it("hides the trigger when subscriptions and feeds are disabled", () => {
  render(<SubscribeDialog {...props} allowPageSubscribers={false} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("starts on a feed when page subscriptions are disabled", () => {
  render(<SubscribeDialog {...props} allowPageSubscribers={false} allowRssFeed />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByRole("tab", { name: /email/i })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /rss/i })).toHaveAttribute("data-state", "active");
});
