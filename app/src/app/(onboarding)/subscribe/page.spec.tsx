import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useOrganizations } from "@/hooks/use-organizations";
import { toast } from "sonner";
import SubscribePage from "./page";

jest.mock("@/hooks/use-organizations", () => ({ useOrganizations: jest.fn() }));
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("required=true"),
}));

const pricing = {
  plans: ["plus", "pro"].map((id) => ({
    id, name: id === "plus" ? "Plus" : "Pro", price: id === "plus" ? 49 : 149,
    interval: "month", description: "Managed testing and monitoring",
    features: {
      monitors: 25, playwrightMinutes: 3000, k6VuMinutes: 20000,
      aiCredits: 100, sreInvestigationUnits: 25, teamMembers: 5,
      projects: 10, monitorDataRetention: "7 days raw / 30 days metrics",
      jobDataRetention: "30 days", customDomains: true, support: "Email support",
    },
    overagePricing: { playwrightMinutes: 0.03, k6VuMinutes: 0.005, aiCredits: 0.05, sreInvestigationUnits: 0.5 },
  })),
  featureComparison: [], faqs: [],
};

describe("signup plan selection", () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();
  const mockUseOrganizations = useOrganizations as jest.Mock;
  const organization = { id: "org-default", name: "My team", role: "org_owner", subscriptionStatus: null };

  beforeEach(() => {
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
    expect(screen.getAllByText("100 AI credits/month (hard limit)")).toHaveLength(2);
    expect(screen.getAllByText("25 completed AI SRE reports/month")).toHaveLength(2);
    expect(screen.queryByText("Most Popular")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How do AI credits work?" }));
    expect(screen.getByText(/even if it later fails/)).toBeVisible();
    expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute("href", "https://supercheck.io/terms");
    expect(screen.getByRole("link", { name: "Get in touch about Enterprise" })).toHaveAttribute("href", "mailto:hello@supercheck.io");
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
    expect(await openPage()).toBeDisabled();
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

  it("recovers from a failed plan lookup without exposing checkout", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });
    render(<SubscribePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Continue with Plus" })).toBeEnabled();
    expect(mockFetch.mock.calls.every(([url]) => url === "/api/billing/pricing")).toBe(true);
  });

  it("pins checkout to the displayed organization and allows retry after rejection", async () => {
    const button = await openPage();
    mockFetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Organization context changed" }) });
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unable to start checkout", { description: "Organization context changed" }));
    expect(mockFetch).toHaveBeenCalledWith("/api/billing/checkout", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ plan: "plus", organizationId: "org-default" }),
    }));
    expect(button).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue with Pro" })).toBeEnabled();
  });
});
