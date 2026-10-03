import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubscriptionTab } from "./subscription-tab";
import SubscribePage from "../../app/(onboarding)/subscribe/page";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock("@/components/billing/spending-limits", () => ({
  SpendingLimits: ({ onSaved }: { onSaved: () => Promise<void> }) => (
    <button onClick={onSaved}>Refresh after save</button>
  ),
}));

const mockUseOrganizations = jest.fn(() => ({
  activeOrganization: { id: "org_1", name: "Test organization", role: "org_owner", subscriptionStatus: "none" },
  isPending: false, isError: false,
}));
jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: () => mockUseOrganizations() }));

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
const pricing = { plans: [{
  id: "pro", name: "Pro", price: 149,
  features: { playwrightMinutes: 10000, k6VuMinutes: 75000, sreInvestigationUnits: 100 },
  overagePricing: { playwrightMinutes: 0.02, k6VuMinutes: 0.0025, sreInvestigationUnits: 0.5 },
}] };

describe("SubscriptionTab", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { id: "org_1", name: "Test organization", role: "org_owner", subscriptionStatus: "none" }, isPending: false, isError: false });
    fetchMock.mockReset().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => url.endsWith("/current") ? billing
        : url.endsWith("/pricing") ? pricing : { spending: { currentDollars: 1.25 } },
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
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

  it("compares all billable meters before suggesting Pro", async () => {
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith("/current") ? { ...billing, usage: { ...billing.usage,
        playwrightMinutes: { ...meter, used: 11000 },
        k6VuMinutes: { ...meter, used: 76000 },
        sreInvestigations: { ...meter, used: 102 },
      } } : url.endsWith("/pricing") ? pricing : { spending: { currentDollars: 300 } },
    }));
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("$349.00");
    expect(await screen.findByText(/Pro would cost about \$172.50/)).toHaveTextContent("$176.50 less");
    expect(screen.getByRole("link", { name: "Compare plans" })).toHaveAttribute("href", "/subscribe");
    expect(screen.getByText(/this organization only/)).toBeInTheDocument();
  });

  it("keeps billing available when the optional plan comparison fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/pricing")) throw new Error("Pricing unavailable");
      return { ok: true, json: async () => url.endsWith("/current") ? billing : { spending: { currentDollars: 300 } } };
    });
    render(<SubscriptionTab currentUserRole="org_owner" />);
    await screen.findByText("$349.00");
    expect(screen.queryByRole("link", { name: "Compare plans" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage Subscription" })).toBeEnabled();
  });

  it("renders monthly organization pricing and precise fractional rates on the plan selection page", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({
      plans: [{ ...pricing.plans[0], name: "Pro", interval: "month", description: "Growing teams",
        features: { ...pricing.plans[0].features, monitors: 100, aiCredits: 300, teamMembers: 25,
          projects: 50, monitorDataRetention: "7d raw / 90d metrics", jobDataRetention: "90d" },
      }],
      featureComparison: [],
      overagePricing: {
        plus: { playwrightMinutes: 0.03, k6VuMinutes: 0.005, sreInvestigationUnits: 0.5 },
        pro: { playwrightMinutes: 0.02, k6VuMinutes: 0.0025, sreInvestigationUnits: 0.5 },
      },
    }) });
    render(<SubscribePage />);
    expect(await screen.findByText("Monthly subscription per organization")).toBeInTheDocument();
    expect(screen.getByText("$5.00 per 1,000 VU-min")).toBeInTheDocument();
    expect(screen.getByText("$2.50 per 1,000 VU-min")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enterprise" }).parentElement?.parentElement).not.toHaveTextContent(/\$/);
    expect(screen.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", "mailto:hello@supercheck.io");
    expect(screen.queryByText(/annual/i)).not.toBeInTheDocument();
  });
  it("does not let an invited member start a personal subscription for the organization", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { id: "org_1", name: "Invited organization", role: "project_editor", subscriptionStatus: "none" }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByText("Subscription for Invited organization")).toBeInTheDocument();
    expect(screen.getByText(/Only this organization's owner can subscribe/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Get Started with Pro" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/billing/checkout", expect.anything());
  });

  it("directs an existing paid owner to manage the plan instead of buying it again", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { id: "org_1", name: "Paid organization", role: "org_owner", subscriptionStatus: "active" }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("link", { name: "Manage subscription" })).toHaveAttribute("href", "/org-admin?tab=subscription");
    expect(screen.getByRole("button", { name: "Get Started with Pro" })).toBeDisabled();
  });

});
