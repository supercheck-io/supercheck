import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import OrgAdminDashboard from "./page";

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams("tab=projects");
const mockPush = jest.fn();
const mockRouter = { replace: mockReplace, push: mockPush };
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
  ProjectsTable: ({ onCreateProject }: { onCreateProject: () => void }) => (
    <button type="button" onClick={onCreateProject}>Open create</button>
  ),
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
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OrgAdminDashboard />
    </QueryClientProvider>,
  );

async function fillDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Open create" }));
  fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Payments" } });
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Payments stack" } });
}

beforeEach(() => {
  mockPush.mockReset();
  mockFetch.mockReset().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: { id: "new-id" } }) });
  global.fetch = mockFetch;
});

it("Create and set up creates the project then opens its setup", async () => {
  renderPage();
  await fillDialog();
  fireEvent.click(screen.getByRole("button", { name: "Create and set up" }));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/setup?project=new-id"));
  expect(mockFetch).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "POST" }));
});

it("plain Create stays on the page", async () => {
  renderPage();
  await fillDialog();
  fireEvent.click(screen.getByRole("button", { name: "Create Project" }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/projects", expect.anything()));
  expect(mockPush).not.toHaveBeenCalled();
});

it("does not open setup when creation fails", async () => {
  mockFetch.mockResolvedValue({ ok: false, json: async () => ({ success: false, error: "nope" }) });
  renderPage();
  await fillDialog();
  fireEvent.click(screen.getByRole("button", { name: "Create and set up" }));
  await waitFor(() => expect(mockFetch).toHaveBeenCalledWith("/api/projects", expect.anything()));
  expect(mockPush).not.toHaveBeenCalled();
});
