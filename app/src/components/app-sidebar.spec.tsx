import { render, screen, within } from "@testing-library/react";

let mockStatus = { isAdmin: false, isOrgAdmin: true, isLoading: false };
jest.mock("@/hooks/use-admin-status", () => ({ useAdminStatus: () => mockStatus }));
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
// Render each NavMain as a labelled region listing its top-level item titles.
jest.mock("@/components/nav-main", () => ({
  NavMain: ({ groupLabel, items }: { groupLabel: string; items: Array<{ title: string }> }) => (
    <section data-testid={`group-${groupLabel || "ungrouped"}`}>
      {items.map((i) => <span key={i.title}>{i.title}</span>)}
    </section>
  ),
}));

import { AppSidebar } from "./app-sidebar";

describe("AppSidebar", () => {
  beforeEach(() => { mockStatus = { isAdmin: false, isOrgAdmin: true, isLoading: false }; });

  it("renders Respond first with Dashboard then Incidents, and Communicate with Notifications", () => {
    render(<AppSidebar />);
    const groups = screen.getAllByTestId(/^group-/);
    expect(groups[0]).toHaveAttribute("data-testid", "group-Respond");
    expect(groups[0].textContent).toMatch(/^DashboardIncidents/);
    expect(groups[1]).toHaveAttribute("data-testid", "group-Communicate");
    expect(groups[1].textContent).toBe("Status PagesNotifications");
    expect(screen.queryByText("Alerts")).toBeNull();
  });

  it("labels the org settings entry Organization, with no bare Admin item", () => {
    render(<AppSidebar />);
    const settings = screen.getByTestId("group-Settings");
    expect(within(settings).getByText("Organization")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).toBeNull();
  });
});
