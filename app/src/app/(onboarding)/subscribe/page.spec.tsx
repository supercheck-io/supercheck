import { useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useOrganizations } from "@/hooks/use-organizations";
import { toast } from "sonner";
import SubscribePage from "./page";

jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: jest.fn() }));

const pricing = {
  plans: ["plus", "pro"].map((id) => ({
    id, name: id === "plus" ? "Plus" : "Pro", price: id === "plus" ? 49 : 149,
    interval: "month", description: "Managed testing and monitoring",
    features: {
      monitors: 50, playwrightMinutes: 3000, k6VuMinutes: 30000,
      aiCredits: 1000, sreInvestigationUnits: 200, teamMembers: 5,
      projects: 10, statusPages: 5, monitorDataRetention: "7 days raw / 30 days metrics",
      jobDataRetention: "30 days", customDomains: true, support: "Email support",
    },
    overagePricing: { playwrightMinutes: 0.01, k6VuMinutes: 0.002, aiCredits: 0, sreInvestigationUnits: 0.1 },
  })),
  featureComparison: [], faqs: [],
};

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));

function subscriptionAccessFixture() {
  const org = (useOrganizations as jest.Mock)().activeOrganization;
  const isActive = org?.subscriptionStatus === "active" || org?.subscriptionStatus === "past_due" ||
    (org?.subscriptionStatus === "canceled" && new Date(org.subscriptionEndsAt).getTime() > Date.now());
  return {
    data: org ? { organizationId: org.id, isActive: Boolean(isActive), plan: isActive ? "plus" : null,
      status: org.subscriptionStatus ?? "none", subscriptionEndsAt: org.subscriptionEndsAt,
      reason: isActive ? "active" : org.subscriptionStatus === "canceled" ? "canceled_expired" : "inactive" } : undefined,
    isPending: !org, isError: false, refetch: jest.fn(),
  };
}

describe("signup plan selection", () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();
  const mockUseOrganizations = useOrganizations as jest.Mock;
  const organization = { id: "org-default", name: "My team", role: "org_owner", subscriptionStatus: null };

  beforeEach(() => {
    (useQuery as jest.Mock).mockReset().mockImplementation(subscriptionAccessFixture);
    jest.clearAllMocks();
    mockUseOrganizations.mockReturnValue({ activeOrganization: organization, isPending: false, isError: false });
    mockFetch.mockReset().mockResolvedValue({ ok: true, json: async () => pricing });
    global.fetch = mockFetch;
  });
  afterEach(() => { global.fetch = originalFetch; });

  async function openPage() {
    render(<SubscribePage />);
    return screen.findByRole("button", { name: "Continue with Plus" });
  }

  it("lets an owner review plans and explains the separate AI meters", async () => {
    expect(await openPage()).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Plus", level: 2 })).toBeVisible();
    expect(screen.getAllByText("1,000 AI credits/month · fair use")).toHaveLength(2);
    expect(screen.getAllByText("200 completed AI SRE reports/month")).toHaveLength(2);
    expect(screen.queryByText("Most Popular")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Compare plans in detail" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Compare all features and pricing/ })).toHaveAttribute("href", "https://supercheck.io/pricing");
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "https://supercheck.io/terms");
    expect(screen.getByRole("link", { name: "Contact us about Enterprise" })).toHaveAttribute("href", "mailto:hello@supercheck.io");
  });

  it("keeps the external-tab notice accessible without repeating it visually", async () => {
    await openPage();
    const comparison = screen.getByRole("link", { name: /Compare all features and pricing/ });
    expect(comparison).toHaveAttribute("target", "_blank");
    expect(comparison.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(comparison.querySelector(".sr-only")).toHaveTextContent("opens in a new tab");
  });

  it.each(["org_admin", "project_editor", "project_viewer"])("prevents checkout for an invited %s", async (role) => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, role }, isPending: false, isError: false });
    const button = await openPage();
    expect(button).toBeDisabled();
    expect(screen.queryByText(/Choose a plan to activate/)).not.toBeInTheDocument();
    expect(screen.getByText(/Only this organization's owner can subscribe/)).toBeVisible();
    fireEvent.click(button);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { subscriptionStatus: "active" },
    { subscriptionStatus: "past_due" },
    { subscriptionStatus: "canceled", subscriptionEndsAt: "2999-01-01T00:00:00Z" },
  ])("avoids a duplicate subscription for %j", async (status) => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, ...status }, isPending: false, isError: false });
    render(<SubscribePage />);
    await screen.findByRole("link", { name: "Manage subscription" });
    expect(screen.queryByRole("button", { name: "Continue with Plus" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage subscription" })).toHaveAttribute("href", "/org-admin?tab=subscription");
    expect(screen.queryByText(/Choose a plan to activate/)).not.toBeInTheDocument();
  });

  it.each([
    { activeOrganization: null, isPending: true, isError: false },
    { activeOrganization: null, isPending: false, isError: true },
    { activeOrganization: null, isPending: false, isError: false },
  ])("waits for verified organization ownership: %j", async (state) => {
    mockUseOrganizations.mockReturnValue(state);
    expect(await openPage()).toBeDisabled();
  });

  it.each(["2020-01-01T00:00:00Z", null, "invalid"])("explains expired access and allows resubscription: %s", async subscriptionEndsAt => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "canceled", subscriptionEndsAt }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("button", { name: "Resubscribe to Plus" })).toBeEnabled();
    expect(screen.getByRole("heading", { name: "Restore your subscription" })).toBeVisible();
    expect(screen.queryByText(/activate your organization/)).not.toBeInTheDocument();
  });

  it("recognizes a terminated subscription whose plan was cleared by a webhook", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "none", subscriptionEndsAt: "2020-01-01T00:00:00Z" }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("button", { name: "Resubscribe to Plus" })).toBeEnabled();
  });

  it("keeps existing billing reachable when plan pricing is unavailable", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "active" }, isPending: false, isError: false });
    mockFetch.mockResolvedValueOnce({ ok: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("link", { name: "Manage subscription" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Plus" })).not.toBeInTheDocument();
  });

  it("keeps overdue payments on the existing subscription", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "past_due" }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("heading", { name: "Update your payment method" })).toBeVisible();
    expect(screen.getByText(/keep your existing subscription/)).toBeVisible();
    expect(screen.queryByText(/Billed monthly per organization/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage subscription" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Continue with Plus" })).not.toBeInTheDocument();
  });

  it.each(["missing_plan", "invalid_plan", "polar_customer_missing", "polar_customer_invalid"])("offers billing recovery for denied existing subscriptions: %s", async reason => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "active", subscriptionPlan: null }, isPending: false, isError: false });
    (useQuery as jest.Mock).mockReturnValue({ data: { organizationId: organization.id, isActive: false, plan: null, status: "active", reason }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("heading", { name: "Review your billing setup" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Manage subscription" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Contact support" })).toBeVisible();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it.each(["2020-01-01T00:00:00Z", null, "invalid"])("allows recovery for an ended cancellation with incomplete billing data: %s", async subscriptionEndsAt => {
    (useQuery as jest.Mock).mockReturnValue({ data: { organizationId: organization.id, isActive: false, plan: null, status: "canceled", reason: "missing_plan", subscriptionEndsAt }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("button", { name: "Resubscribe to Plus" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Review your billing setup" })).not.toBeInTheDocument();
  });

  it("preserves duplicate-purchase protection for an incomplete cancellation in its paid period", async () => {
    (useQuery as jest.Mock).mockReturnValue({ data: { organizationId: organization.id, isActive: false, plan: null, status: "canceled", reason: "missing_plan", subscriptionEndsAt: "2999-01-01T00:00:00Z" }, isPending: false, isError: false });
    render(<SubscribePage />);
    expect(await screen.findByRole("heading", { name: "Review your billing setup" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Resubscribe to/ })).not.toBeInTheDocument();
  });

  it("trusts server access over a stale organization summary", async () => {
    mockUseOrganizations.mockReturnValue({ activeOrganization: { ...organization, subscriptionStatus: "active" }, isPending: false, isError: false });
    (useQuery as jest.Mock).mockReturnValue({ data: { organizationId: organization.id, isActive: false, plan: null, status: "none", reason: "inactive" }, isPending: false, isError: false });
    expect(await openPage()).toBeEnabled();
  });

  it("blocks checkout while access is being checked", () => {
    (useQuery as jest.Mock).mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<SubscribePage />);
    expect(screen.getByRole("status", { name: "Loading plans" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it("offers retry rather than checkout after an access lookup error", async () => {
    const refetch = jest.fn();
    (useQuery as jest.Mock).mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    render(<SubscribePage />);
    expect(screen.getByRole("heading", { name: "Unable to verify your subscription" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Continue with/ })).not.toBeInTheDocument();
  });

  it("pins the access request and rejects another organization's response", async () => {
    await openPage();
    const { queryFn, queryKey } = (useQuery as jest.Mock).mock.calls[0][0];
    expect(queryKey).toEqual(["subscription-status", organization.id]);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ organizationId: "another-org", isActive: true }) });
    await expect(queryFn()).rejects.toThrow("Organization changed");
    expect(mockFetch).toHaveBeenLastCalledWith("/api/subscription/status?organizationId=org-default");
  });

  it("recovers from a failed plan lookup without exposing checkout", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    render(<SubscribePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Continue with Plus" })).toBeEnabled();
    expect(mockFetch.mock.calls.every(([url]) => url === "/api/billing/pricing")).toBe(true);
  });

  it("pins checkout to the displayed organization and allows retry after rejection", async () => {
    const button = await openPage();
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Organization context changed" }) });
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to start checkout", { description: "Organization context changed" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/billing/checkout", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ plan: "plus", organizationId: "org-default" }),
    }));
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Pro" })).toBeEnabled();
  });
});
