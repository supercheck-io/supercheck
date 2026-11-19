import type { ReactElement } from "react";
import MainLayout from "./layout";
import { getCurrentUser, getActiveOrganization } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";
import { getTrialSummary } from "@/lib/execution/trial-limits";
import { getUserOrgRole } from "@/lib/rbac/middleware";
import { getSelectableProjects } from "@/lib/session";
import { isSelfHosted } from "@/lib/feature-flags";
import { PendingDeletionBanner } from "@/components/pending-deletion-banner";
import { SpendingCapBanner } from "@/components/spending-cap-banner";
import { TrialBanner } from "@/components/trial-banner";

// The layout only needs to run its data fetching here; every UI import is stubbed.
jest.mock("@/components/app-sidebar", () => ({}));
jest.mock("@/components/ui/separator", () => ({}));
jest.mock("@/components/ui/sidebar", () => ({}));
jest.mock("@/components/parallel-threads", () => ({}));
jest.mock("@/components/breadcrumb-context", () => ({}));
jest.mock("@/components/breadcrumb-display", () => ({}));
jest.mock("@/components/jobs/job-context", () => ({}));
jest.mock("@/components/ui/command-search", () => ({}));
jest.mock("@/components/setup-checker", () => ({}));
jest.mock("@/hooks/use-project-context", () => ({}));
jest.mock("@/components/nav-user", () => ({}));
jest.mock("@/components/demo-badge", () => ({}));
jest.mock("@/components/community-links", () => ({}));
jest.mock("@/components/subscription-guard", () => ({}));
jest.mock("@/components/auth-guard", () => ({}));
jest.mock("@/components/data-prefetcher", () => ({}));
jest.mock("@/components/monaco-prefetcher", () => ({}));
jest.mock("@/components/recorder/RecorderAutoConnect", () => ({}));
jest.mock("@/components/sentry-browser", () => ({}));
jest.mock("@/components/trial-banner", () => ({ TrialBanner: () => null }));
jest.mock("@/components/spending-cap-banner", () => ({ SpendingCapBanner: () => null }));
jest.mock("@/components/pending-deletion-banner", () => ({ PendingDeletionBanner: () => null }));
jest.mock("@/lib/sentry-gate", () => ({ getSentryDsn: () => null }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: jest.fn(() => true) }));
jest.mock("@/lib/execution/trial-limits", () => ({ getTrialSummary: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => false), getUserOrgRole: jest.fn() }));
jest.mock("@/lib/rbac/permissions", () => ({ Role: { ORG_OWNER: "org_owner", ORG_ADMIN: "org_admin" } }));
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
  getActiveOrganization: jest.fn(),
  getSelectableProjects: jest.fn(async () => []),
}));
jest.mock("@/lib/project-context", () => ({ getCurrentProjectContext: jest.fn(async () => null) }));

describe("MainLayout data fetching", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (isSelfHosted as jest.Mock).mockReturnValue(true);
    (getSelectableProjects as jest.Mock).mockResolvedValue([]);
    (getCurrentProjectContext as jest.Mock).mockResolvedValue(null);
  });

  it.each([
    ["no user", null, { id: "o1" }],
    ["no organization", { id: "u1" }, null],
  ])("does not resolve the project context with %s", async (_label, user, org) => {
    (getCurrentUser as jest.Mock).mockResolvedValue(user);
    (getActiveOrganization as jest.Mock).mockResolvedValue(org);
    await MainLayout({ children: null });
    expect(getCurrentProjectContext).not.toHaveBeenCalled();
  });

  it("resolves the project context for a signed-in user with an organization", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1", name: "U", email: "u@x" });
    (getActiveOrganization as jest.Mock).mockResolvedValue({ id: "o1" });
    await MainLayout({ children: null });
    expect(getCurrentProjectContext).toHaveBeenCalledTimes(1);
  });

  // Walks the returned element tree for the first element of a given component type.
  function findProps(node: unknown, type: unknown): Record<string, unknown> | undefined {
    if (!node || typeof node !== "object") return undefined;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findProps(child, type);
        if (found) return found;
      }
      return undefined;
    }
    const el = node as ReactElement<{ children?: unknown }>;
    if (el.type === type) return el.props as Record<string, unknown>;
    return findProps(el.props?.children, type);
  }

  const cloudOrg = (extra: object = {}) => ({
    id: "o1",
    subscriptionPlan: "pro",
    subscriptionStatus: "active",
    ...extra,
  });
  const signedIn = (org: object) => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1", name: "U", email: "u@x" });
    (getActiveOrganization as jest.Mock).mockResolvedValue(org);
    (isSelfHosted as jest.Mock).mockReturnValue(false);
  };

  it("shows the spending cap and owner banner flags for a paying org owner", async () => {
    signedIn(cloudOrg());
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_owner");
    const tree = await MainLayout({ children: null });
    expect(findProps(tree, SpendingCapBanner)).toEqual({ enabled: true });
    expect(findProps(tree, PendingDeletionBanner)).toMatchObject({ pending: false, isOwner: true });
  });

  it("hides the spending cap for a paying member who is not an admin", async () => {
    signedIn(cloudOrg());
    (getUserOrgRole as jest.Mock).mockResolvedValue("org_member");
    const tree = await MainLayout({ children: null });
    expect(findProps(tree, SpendingCapBanner)).toEqual({ enabled: false });
    expect(findProps(tree, PendingDeletionBanner)).toMatchObject({ isOwner: false });
  });

  it("falls back to no role when the role lookup rejects", async () => {
    signedIn(cloudOrg({ deletionRequestedAt: new Date() }));
    (getUserOrgRole as jest.Mock).mockRejectedValue(new Error("db down"));
    const tree = await MainLayout({ children: null });
    expect(findProps(tree, SpendingCapBanner)).toEqual({ enabled: false });
    expect(findProps(tree, PendingDeletionBanner)).toMatchObject({ pending: true, isOwner: false });
  });

  it("passes the trial summary for an unsubscribed org, and null when the lookup rejects", async () => {
    signedIn({ id: "o1", subscriptionPlan: null, subscriptionStatus: null });
    (getTrialSummary as jest.Mock).mockResolvedValue({ daysLeft: 3 });
    let tree = await MainLayout({ children: null });
    expect(findProps(tree, TrialBanner)).toEqual({ initialTrial: { daysLeft: 3 } });
    expect(getUserOrgRole).not.toHaveBeenCalled();

    (getTrialSummary as jest.Mock).mockRejectedValue(new Error("db down"));
    tree = await MainLayout({ children: null });
    expect(findProps(tree, TrialBanner)).toEqual({ initialTrial: null });
  });

  it("starts every lookup before any of them resolves", async () => {
    signedIn({ id: "o1", subscriptionPlan: null, subscriptionStatus: null, deletionRequestedAt: new Date() });
    const gates: Array<() => void> = [];
    const deferred = <T,>(value: T) => new Promise<T>((resolve) => gates.push(() => resolve(value)));
    (getUserOrgRole as jest.Mock).mockReturnValue(deferred("org_owner"));
    (getTrialSummary as jest.Mock).mockReturnValue(deferred(null));
    (getSelectableProjects as jest.Mock).mockReturnValue(deferred([]));
    (getCurrentProjectContext as jest.Mock).mockReturnValue(deferred(null));

    const done = MainLayout({ children: null });
    // Let the user/org lookups settle; none of the four gated lookups has resolved yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getUserOrgRole).toHaveBeenCalledTimes(1);
    expect(getTrialSummary).toHaveBeenCalledTimes(1);
    expect(getSelectableProjects).toHaveBeenCalledTimes(1);
    expect(getCurrentProjectContext).toHaveBeenCalledTimes(1);
    gates.forEach((open) => open());
    await done;
  });
});
