import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubscriptionTab } from "./subscription-tab";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/components/billing/spending-limits", () => ({
  SpendingLimits: ({ onSaved }: { onSaved: () => Promise<void> }) => (
    <button onClick={onSaved}>Refresh after save</button>
  ),
}));

const meter = { used: 0, included: 100, overage: 0, percentage: 0 };
const resource = { current: 1, limit: 5, remaining: 4, percentage: 20 };
const subscription = {
  plan: "plus", status: "active", basePriceCents: 4900,
  currentPeriodStart: null, currentPeriodEnd: null, hasBillingCustomer: true,
};
const billing = {
  subscription,
  usage: { playwrightMinutes: { ...meter, used: 0.0833 }, k6VuMinutes: meter, aiCredits: meter, sreInvestigations: meter },
  limits: { monitors: resource, statusPages: resource, projects: resource, teamMembers: resource },
  planFeatures: { dataRetentionDays: 7, aggregatedDataRetentionDays: 30 },
};

describe("SubscriptionTab", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/current") ? billing : { spending: { currentDollars: 1.25 } },
    }));
    global.fetch = fetchMock;
  });
  afterEach(() => { global.fetch = originalFetch; });

  it("shows fractional minutes, real period availability, and an owner portal action", async () => {
    render(<SubscriptionTab currentUserRole="org_owner" />);
    expect(await screen.findByText("$50.25")).toBeInTheDocument();
    expect(screen.getByText("Billing period unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage Subscription" })).toBeEnabled();
    expect(screen.getByRole("progressbar", { name: "Playwright Execution Minutes" }))
      .toHaveAttribute("aria-valuetext", "0.0833 used of 100 included");
    expect(screen.getByText("0.0833 / 100")).toBeInTheDocument();
  });

  it("does not offer the owner portal action to an admin", async () => {
    render(<SubscriptionTab currentUserRole="org_admin" />);
    await screen.findByText("Plus Plan");
    expect(screen.queryByRole("button", { name: "Manage Subscription" })).not.toBeInTheDocument();
  });

  it("clears a stale estimate when usage cannot be refreshed", async () => {
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("$50.25");
    fetchMock.mockImplementation(async (url: string) => ({
      ok: url.endsWith("/current"), json: async () => billing,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh after save" }));
    expect(await screen.findByText("Usage estimate unavailable")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("$50.25")).not.toBeInTheDocument();
  });

  it("retains the estimate while refreshing and clears it if subscription refresh fails", async () => {
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("$50.25");
    let resolveCurrent!: (response: { ok: boolean; json: () => Promise<object> }) => void;
    const pendingCurrent = new Promise((resolve) => { resolveCurrent = resolve; });
    fetchMock.mockImplementation(async (url: string) => url.endsWith("/current")
      ? pendingCurrent
      : { ok: true, json: async () => ({ spending: { currentDollars: 5 } }) });
    fireEvent.click(screen.getByRole("button", { name: "Refresh after save" }));
    expect(screen.getByText("$50.25")).toBeInTheDocument();
    expect(screen.queryByText("Usage estimate unavailable")).not.toBeInTheDocument();
    await act(async () => { resolveCurrent({ ok: false, json: async () => ({ error: "Unavailable" }) }); });
    expect(await screen.findByText("Unable to load subscription data")).toBeInTheDocument();
    expect(screen.queryByText("Plus Plan")).not.toBeInTheDocument();
    expect(screen.queryByText("$54.00")).not.toBeInTheDocument();
  });

  it("ignores an older refresh failure after a newer refresh succeeds", async () => {
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("$50.25");
    let failEarlier!: (error: Error) => void;
    const earlier = new Promise((_, reject) => { failEarlier = reject; });
    fetchMock.mockImplementation(async (url: string) => url.endsWith("/current")
      ? earlier : { ok: true, json: async () => ({ spending: { currentDollars: 5 } }) });
    fireEvent.click(screen.getByRole("button", { name: "Refresh after save" }));
    fetchMock.mockImplementation(async (url: string) => ({ ok: true,
      json: async () => url.endsWith("/current") ? billing : { spending: { currentDollars: 2 } },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh after save" }));
    await screen.findByText("$51.00");
    await act(async () => { failEarlier(new Error("Older request failed")); });
    expect(screen.getByText("$51.00")).toBeInTheDocument();
    expect(screen.queryByText("Usage estimate unavailable")).not.toBeInTheDocument();
  });

  it("offers recovery without a paid-plan estimate after an expired cancellation", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/current")
        ? { ...billing, subscription: { ...subscription, plan: null, status: "canceled", basePriceCents: null } }
        : { spending: { currentDollars: 0 } },
    }));
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("No active plan");
    expect(screen.getByRole("link", { name: "Choose a plan" })).toHaveAttribute("href", "/subscribe");
    expect(screen.getByRole("button", { name: "Manage Subscription" })).toBeEnabled();
    expect(screen.queryByText("$49.00")).not.toBeInTheDocument();
  });
});
