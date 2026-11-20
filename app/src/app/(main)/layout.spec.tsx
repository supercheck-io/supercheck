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
import { ShellBootstrapProvider } from "@/components/shell-bootstrap";
import { SentryBrowser } from "@/components/sentry-browser";
import { getSentryDsn } from "@/lib/sentry-gate";
import { getSentryBrowserConfig } from "@/lib/sentry-client-config";
import { getImpersonationStatus } from "@/lib/impersonation-status";
import { getUserPreferences } from "@/lib/setup/setup-state";
import { getSetupSummary } from "@/lib/setup/summary";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";

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
jest.mock("@/components/sentry-browser", () => ({ SentryBrowser: () => null }));
jest.mock("@/components/trial-banner", () => ({ TrialBanner: () => null }));
jest.mock("@/components/spending-cap-banner", () => ({ SpendingCapBanner: () => null }));
jest.mock("@/components/pending-deletion-banner", () => ({ PendingDeletionBanner: () => null }));
jest.mock("@/lib/sentry-gate", () => ({ getSentryDsn: jest.fn() }));
jest.mock("@/lib/sentry-client-config", () => ({ getSentryBrowserConfig: jest.fn() }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers({ host: "app.example.com" })) }));
jest.mock("@/lib/impersonation-status", () => ({ getImpersonationStatus: jest.fn() }));
jest.mock("@/lib/setup/setup-state", () => ({ getUserPreferences: jest.fn() }));
jest.mock("@/lib/setup/summary", () => ({ getSetupSummary: jest.fn() }));
let mockSetupEnabled = true;
jest.mock("@/lib/setup/features", () => ({ resolveSetupFeatures: () => ({ setup: mockSetupEnabled }) }));
jest.mock("@/lib/ai/ai-provider", () => ({ isAIProviderConfigured: () => false }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: jest.fn(() => true) }));
jest.mock("@/lib/execution/trial-limits", () => ({ getTrialSummary: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => false), getUserOrgRole: jest.fn() }));
jest.mock("@/lib/rbac/permissions", () => ({ Role: { ORG_OWNER: "org_owner", ORG_ADMIN: "org_admin", SUPER_ADMIN: "super_admin" } }));
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
    (getImpersonationStatus as jest.Mock).mockResolvedValue({ isImpersonating: false });
    (getUserPreferences as jest.Mock).mockResolvedValue({ persona: null, seen: true });
    (getUserOrgRole as jest.Mock).mockResolvedValue(null);
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
    // The role is always read now: the sidebar's admin links come from it.
    expect(getUserOrgRole).toHaveBeenCalledWith("u1", "o1");

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

  describe("shell bootstrap", () => {
    it("passes only the impersonated user, never the original admin's details", async () => {
      signedIn(cloudOrg());
      (getImpersonationStatus as jest.Mock).mockResolvedValue({
        isImpersonating: true,
        impersonatedUser: { id: "u1", name: "U", email: "u@x" },
        originalAdmin: { id: "a1", name: "Admin", email: "admin@x" },
      });
      const value = findProps(await MainLayout({ children: null }), ShellBootstrapProvider)?.value as Record<string, unknown>;
      expect(value.impersonation).toEqual({ isImpersonating: true, impersonatedUser: { id: "u1", name: "U", email: "u@x" } });
    });

    const bootstrapOf = (tree: unknown) => findProps(tree, ShellBootstrapProvider)?.value as Record<string, unknown>;
    const project = { id: "p1", organizationId: "o1", userRole: "project_viewer" };

    it("passes the admin flags, impersonation, preferences and setup summary the shell would request", async () => {
      signedIn(cloudOrg());
      (getCurrentUser as jest.Mock).mockResolvedValue({ id: "u1", name: "U", email: "u@x", role: "super_admin" });
      (getUserOrgRole as jest.Mock).mockResolvedValue("org_admin");
      (getCurrentProjectContext as jest.Mock).mockResolvedValue(project);
      (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
      (getImpersonationStatus as jest.Mock).mockResolvedValue({ isImpersonating: false });
      (getSetupSummary as jest.Mock).mockResolvedValue({ status: "in_progress", done: 1, total: 4, projectEmpty: false });
      const value = bootstrapOf(await MainLayout({ children: null }));
      expect(value).toMatchObject({
        adminStatus: { isAdmin: true, isOrgAdmin: true },
        impersonation: { isImpersonating: false, impersonatedUser: undefined },
        preferences: { persona: null, seen: true },
        setupSummary: { projectId: "p1", summary: { status: "in_progress", done: 1, total: 4, projectEmpty: false } },
      });
      expect(typeof value.readAt).toBe("number");
      expect(value.userId).toBe("u1");
      expect(getSetupSummary).toHaveBeenCalledWith("o1", "p1", "u1");
    });

    it("reports a plain member as neither admin", async () => {
      signedIn(cloudOrg());
      (getUserOrgRole as jest.Mock).mockResolvedValue("org_member");
      expect(bootstrapOf(await MainLayout({ children: null })).adminStatus).toEqual({ isAdmin: false, isOrgAdmin: false });
    });

    it("leaves each value out when its lookup fails, so the client requests it", async () => {
      signedIn(cloudOrg());
      (getUserOrgRole as jest.Mock).mockRejectedValue(new Error("db down"));
      (getUserPreferences as jest.Mock).mockRejectedValue(new Error("db down"));
      (getCurrentProjectContext as jest.Mock).mockResolvedValue(project);
      (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
      (getSetupSummary as jest.Mock).mockRejectedValue(new Error("db down"));
      const value = bootstrapOf(await MainLayout({ children: null }));
      expect(value.adminStatus).toBeUndefined();
      expect(value.preferences).toBeUndefined();
      expect(value.setupSummary).toBeUndefined();
    });

    it("does not read the setup summary when setup is turned off", async () => {
      mockSetupEnabled = false;
      try {
        signedIn(cloudOrg());
        (getCurrentProjectContext as jest.Mock).mockResolvedValue(project);
        (checkPermissionWithContext as jest.Mock).mockReturnValue(true);
        const value = bootstrapOf(await MainLayout({ children: null }));
        expect(getSetupSummary).not.toHaveBeenCalled();
        expect(value.setupSummary).toBeUndefined();
      } finally {
        mockSetupEnabled = true;
      }
    });

    it("does not read the setup summary without project view access", async () => {
      signedIn(cloudOrg());
      (getCurrentProjectContext as jest.Mock).mockResolvedValue(project);
      (checkPermissionWithContext as jest.Mock).mockReturnValue(false);
      const value = bootstrapOf(await MainLayout({ children: null }));
      expect(getSetupSummary).not.toHaveBeenCalled();
      expect(value.setupSummary).toBeUndefined();
    });

    it("renders the browser error reporter with its config only when a DSN is set", async () => {
      signedIn(cloudOrg());
      let tree = await MainLayout({ children: null });
      expect(findProps(tree, SentryBrowser)).toBeUndefined();
      expect(getSentryBrowserConfig).not.toHaveBeenCalled();

      (getSentryDsn as jest.Mock).mockReturnValue("https://k@o1.ingest.sentry.io/1");
      (getSentryBrowserConfig as jest.Mock).mockReturnValue({ dsn: "https://k@o1.ingest.sentry.io/1" });
      tree = await MainLayout({ children: null });
      expect(findProps(tree, SentryBrowser)).toEqual({ config: { dsn: "https://k@o1.ingest.sentry.io/1" } });

      // A status-page host gets an empty config: nothing is rendered.
      (getSentryBrowserConfig as jest.Mock).mockReturnValue({});
      tree = await MainLayout({ children: null });
      expect(findProps(tree, SentryBrowser)).toBeUndefined();
    });
  });
});
