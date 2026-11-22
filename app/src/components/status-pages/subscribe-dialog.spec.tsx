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

it("explains that a webhook stays pending until it proves ownership", async () => {
  jest.mocked(subscribeToStatusPage).mockResolvedValue({
    success: true,
    message: "pending",
    requiresVerification: true,
    webhookSecret: "secret",
  });
  render(
    <SubscribeDialog
      {...props}
      allowEmailSubscribers={false}
      allowWebhookSubscribers
    />,
  );
  fireEvent.click(screen.getByRole("button"));
  fireEvent.change(screen.getAllByRole("textbox")[0], {
    target: { value: "https://hooks.example.com/supercheck" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /subscribe via webhook/i }),
  );
  await waitFor(() =>
    expect(screen.getByText(/verification challenge/i)).toBeInTheDocument(),
  );
});

it("starts on a feed when page subscriptions are disabled", () => {
  render(<SubscribeDialog {...props} allowPageSubscribers={false} allowRssFeed />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByRole("tab", { name: /email/i })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /rss/i })).toHaveAttribute("data-state", "active");
});

it("lets visitors pick components (not incidents) and sends only those", async () => {
  jest.mocked(subscribeToStatusPage).mockResolvedValue({ success: true, message: "Check email" });
  const components = [{ id: "00000000-0000-4000-8000-00000000000a", name: "API" }, { id: "00000000-0000-4000-8000-00000000000b", name: "Dashboard" }];
  render(<SubscribeDialog {...props} allowIncidentSubscribers components={components} />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(screen.getByLabelText(/only specific components/i));
  fireEvent.click(screen.getByLabelText("Dashboard"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /subscribe via email/i }));
  await waitFor(() =>
    expect(subscribeToStatusPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ subscribeToAllComponents: false, selectedComponentIds: [components[1].id], selectedIncidentIds: [] }),
    ),
  );
});

it("offers no component choice with a single component", () => {
  render(<SubscribeDialog {...props} components={[{ id: "c", name: "API" }]} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.queryByLabelText(/only specific components/i)).not.toBeInTheDocument();
});

it("follows one incident from its page, without page-wide feeds or a component choice", async () => {
  jest.mocked(subscribeToStatusPage).mockResolvedValue({ success: true, message: "Check email" });
  const incident = { id: "00000000-0000-4000-8000-0000000000aa", name: "Login errors" };
  render(<SubscribeDialog {...props} allowRssFeed allowIncidentSubscribers incident={incident} components={[{ id: "a", name: "A" }, { id: "b", name: "B" }]} />);
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText("Login errors")).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /rss/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/only specific components/i)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "test@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /subscribe via email/i }));
  await waitFor(() =>
    expect(subscribeToStatusPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ subscribeToAllComponents: false, subscribeToAllIncidents: false, selectedComponentIds: [], selectedIncidentIds: [incident.id] }),
    ),
  );
});
