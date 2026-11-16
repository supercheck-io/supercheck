import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let mockPersona: string | null = null;
let mockSetup: unknown = undefined;
let mockSetupOn = true;
jest.mock("@/hooks/use-admin-status", () => ({ useAdminStatus: () => ({ isAdmin: false, isOrgAdmin: false, isLoading: false }) }));
jest.mock("@/hooks/use-project-setup", () => ({
  useUserPreferences: () => ({ data: mockPersona ? { persona: mockPersona, seen: true } : undefined }),
  useProjectSetup: (id: string | null) => ({ data: id ? mockSetup : undefined }),
}));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ setupFeatures: { setup: mockSetupOn } }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContextSafe: () => ({ currentProject: { id: "p1" } }) }));
jest.mock("@/components/project-switcher", () => ({ ProjectSwitcher: () => null }));
jest.mock("@/components/impersonation-card", () => ({ ImpersonationCard: () => null }));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
jest.mock("@/components/ui/sidebar", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Sidebar: Pass, SidebarContent: Pass, SidebarFooter: Pass, SidebarGroup: Pass, SidebarHeader: Pass,
    SidebarMenu: Pass, SidebarMenuButton: Pass, SidebarMenuItem: Pass, SidebarRail: () => null,
  };
});
jest.mock("@/components/nav-main", () => ({
  NavMain: ({ groupLabel, items, collapsible, defaultOpen }: { groupLabel: string; items: Array<{ title: string; badge?: string }>; collapsible?: boolean; defaultOpen?: boolean }) => (
    <section data-testid={`group-${groupLabel || "ungrouped"}`} data-collapsible={String(!!collapsible)} data-open={String(defaultOpen)}>
      {items.map((i) => <span key={i.title}>{i.title}{i.badge}</span>)}
    </section>
  ),
}));

import { AppSidebar } from "./app-sidebar";

const setupData = (status: string) => ({ state: { status }, checklist: { done: 2, total: 8 } });
const renderSidebar = () =>
  render(<QueryClientProvider client={new QueryClient()}><AppSidebar /></QueryClientProvider>);
const labels = () => screen.getAllByTestId(/^group-(?!ungrouped)/).map((g) => g.getAttribute("data-testid")!.slice(6)).slice(0, 4);
const open = (label: string) => screen.getByTestId(`group-${label}`).getAttribute("data-open");

beforeEach(() => { mockPersona = null; mockSetup = undefined; mockSetupOn = true; });

describe("AppSidebar persona layout", () => {
  it.each([
    ["sre", ["Respond", "Monitor", "Communicate", "Automate"], "Respond"],
    ["qa", ["Automate", "Communicate", "Respond", "Monitor"], "Automate"],
    ["developer", ["Automate", "Monitor", "Respond", "Communicate"], "Automate"],
  ])("orders groups for %s and expands only one", (persona, order, expanded) => {
    mockPersona = persona;
    renderSidebar();
    expect(labels()).toEqual(order);
    for (const g of order) {
      expect(open(g)).toBe(String(g === expanded));
      expect(screen.getByTestId(`group-${g}`)).toHaveAttribute("data-collapsible", "true");
    }
  });

  it("leader keeps today's order, all open", () => {
    mockPersona = "leader";
    renderSidebar();
    expect(labels()).toEqual(["Respond", "Communicate", "Automate", "Monitor"]);
    expect(open("Monitor")).toBe("true");
  });

  it("renders today's sidebar with no persona", () => {
    renderSidebar();
    expect(labels()).toEqual(["Respond", "Communicate", "Automate", "Monitor"]);
    expect(screen.getByTestId("group-Respond").textContent).toMatch(/^DashboardIncidents/);
    expect(screen.getByTestId("group-Respond")).toHaveAttribute("data-collapsible", "false");
    expect(screen.getAllByTestId("group-ungrouped")).toHaveLength(1); // Docs only
  });

  it("keeps Dashboard visible outside the folded groups when a persona is set", () => {
    mockPersona = "qa";
    renderSidebar();
    expect(screen.getAllByTestId("group-ungrouped")[0]).toHaveTextContent("Dashboard");
    expect(screen.getByTestId("group-Respond").textContent).not.toContain("Dashboard");
  });
});

describe("AppSidebar project setup entry", () => {
  it("shows the progress badge while setup is open", () => {
    mockSetup = setupData("in_progress");
    renderSidebar();
    expect(screen.getByText("Project setup2/8")).toBeInTheDocument();
  });

  it.each(["completed", "dismissed"])("hides the entry when %s", (status) => {
    mockSetup = setupData(status);
    renderSidebar();
    expect(screen.queryByText(/Project setup/)).toBeNull();
  });

  it("hides the entry while loading or when the feature is off", () => {
    renderSidebar();
    expect(screen.queryByText(/Project setup/)).toBeNull();
  });

  it("hides the entry when the feature is off", () => {
    mockSetup = setupData("not_started");
    mockSetupOn = false;
    renderSidebar();
    expect(screen.queryByText(/Project setup/)).toBeNull();
  });
});
