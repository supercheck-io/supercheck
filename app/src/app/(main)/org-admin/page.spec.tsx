import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import OrgAdminDashboard from "./page";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams("tab=integrations");
const mockRouter = { replace: mockReplace };
const mockSetBreadcrumbs = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/org-admin",
  useSearchParams: () => mockSearchParams,
}));
jest.mock("@/components/breadcrumb-context", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: mockSetBreadcrumbs }),
}));
jest.mock("@/hooks/use-app-config", () => ({
  useAppConfig: () => ({ isCloudHosted: true }),
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));
jest.mock("@/hooks/use-organization", () => ({
  useOrgDetails: () => ({
    details: { id: "org-1", name: "Test organization" },
    isLoading: false,
  }),
  useOrgMembers: () => ({
    members: [],
    invitations: [],
    currentUserRole: "org_owner",
    isLoading: false,
  }),
  useOrgProjects: () => ({ projects: [], isLoading: false }),
  useOrgDataInvalidation: () => ({
    invalidateStats: jest.fn(),
    invalidateMembers: jest.fn(),
    invalidateProjects: jest.fn(),
    invalidateDetails: jest.fn(),
  }),
}));
jest.mock("@/components/admin/audit-logs-table", () => ({
  AuditLogsTable: () => null,
}));
jest.mock("@/components/admin/cli-tokens-table", () => ({
  CliTokensTable: () => null,
}));
jest.mock("@/components/org-admin/members-table", () => ({
  MembersTable: () => null,
}));
jest.mock("@/components/org-admin/projects-table", () => ({
  ProjectsTable: () => null,
}));
jest.mock("@/components/org-admin/project-locations-dialog", () => ({
  ProjectLocationsDialog: () => null,
}));
jest.mock("@/components/org-admin/subscription-tab", () => ({
  SubscriptionTab: () => null,
}));
jest.mock("@/components/members/MemberAccessDialog", () => ({
  MemberAccessDialog: () => null,
}));
jest.mock("@/components/sre/private-agents/private-agents-admin-view", () => ({
  PrivateAgentsAdminView: () => null,
}));
jest.mock("@/components/sre/connectors/connector-admin-view", () => ({
  ConnectorAdminView: ({ onOpenSavedQueries }: { onOpenSavedQueries?: () => void }) => (
    <div>
      <p>Connector management</p>
      <button type="button" onClick={onOpenSavedQueries}>
        Open saved queries
      </button>
    </div>
  ),
}));
jest.mock("@/components/sre/connectors/diagnostic-queries-admin-view", () => ({
  DiagnosticQueriesAdminView: () => <p>Saved query management</p>,
}));

const mockFetch = jest.fn();

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgAdminDashboard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockReplace.mockClear();
  mockFetch.mockReset();
  mockSearchParams = new URLSearchParams("tab=integrations");
  global.fetch = mockFetch;
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      status: null,
      connectors: [],
      setupOptions: { connectors: [], services: [], privateAgents: [] },
      bindings: [],
      bindingSetupOptions: {
        notificationProviders: [],
        connectors: [],
        services: [],
      },
      queries: [],
    }),
  });
});

it("loads saved queries only when their dialog is opened", async () => {
  renderPage();
  await screen.findByText("Connector management");
  expect(
    screen.queryByRole("tab", { name: "Diagnostic Recipes" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Saved query management")).not.toBeInTheDocument();
  expect(mockFetch).not.toHaveBeenCalledWith(
    "/api/sre/diagnostic-recipes",
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open saved queries" }));
  expect(mockReplace).toHaveBeenCalledWith(
    "/org-admin?tab=integrations&section=saved-queries",
    { scroll: false },
  );
  expect(
    await screen.findByRole("dialog", { name: "Saved queries" }),
  ).toBeInTheDocument();
  await screen.findByText("Saved query management");
  expect(mockFetch).toHaveBeenCalledWith(
    "/api/sre/diagnostic-recipes",
    expect.anything(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      screen.queryByText("Saved query management"),
    ).not.toBeInTheDocument(),
  );
  expect(mockReplace).toHaveBeenLastCalledWith("/org-admin?tab=integrations", {
    scroll: false,
  });
});

it.each(["diagnostic-recipes", "runbooks"])(
  "preserves legacy %s deep links",
  async (tab) => {
    mockSearchParams = new URLSearchParams(`tab=${tab}`);
    renderPage();
    await screen.findByText("Saved query management");
    expect(screen.getByRole("tab", { name: "Integrations", hidden: true })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(mockReplace).toHaveBeenCalledWith(
      "/org-admin?tab=integrations&section=saved-queries",
      { scroll: false },
    );
  },
);

it("opens the section from its canonical URL and clears it when changing tabs", async () => {
  mockSearchParams = new URLSearchParams(
    "tab=integrations&section=saved-queries",
  );
  renderPage();
  await screen.findByText("Saved query management");
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Projects", hidden: true }), {
    button: 0,
    ctrlKey: false,
  });
  await waitFor(() =>
    expect(mockReplace).toHaveBeenLastCalledWith("/org-admin", {
      scroll: false,
    }),
  );
  expect(screen.queryByText("Saved query management")).not.toBeInTheDocument();
});
