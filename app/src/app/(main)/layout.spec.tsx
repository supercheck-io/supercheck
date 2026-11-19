import MainLayout from "./layout";
import { getCurrentUser, getActiveOrganization } from "@/lib/session";
import { getCurrentProjectContext } from "@/lib/project-context";

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
jest.mock("@/components/trial-banner", () => ({}));
jest.mock("@/components/spending-cap-banner", () => ({}));
jest.mock("@/components/pending-deletion-banner", () => ({}));
jest.mock("@/lib/sentry-gate", () => ({ getSentryDsn: () => null }));
jest.mock("@/lib/feature-flags", () => ({ isSelfHosted: () => true }));
jest.mock("@/lib/execution/trial-limits", () => ({ getTrialSummary: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: jest.fn(() => false), getUserOrgRole: jest.fn() }));
jest.mock("@/lib/rbac/permissions", () => ({ Role: {} }));
jest.mock("@/lib/session", () => ({
  getCurrentUser: jest.fn(),
  getActiveOrganization: jest.fn(),
  getSelectableProjects: jest.fn(async () => []),
}));
jest.mock("@/lib/project-context", () => ({ getCurrentProjectContext: jest.fn(async () => null) }));

describe("MainLayout data fetching", () => {
  beforeEach(() => jest.clearAllMocks());

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
});
