import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { Globe, Siren } from "lucide-react";

import { NavMain } from "./nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";

jest.mock("next/navigation", () => ({ usePathname: () => "/monitors/abc", useRouter: () => ({ prefetch: jest.fn() }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: null }) }));
jest.mock("@/lib/prefetch-utils", () => ({ prefetchSidebarRoute: jest.fn() }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

it("marks the current page's link active and tints its icon with the group's area colour", () => {
  render(
    <SidebarProvider>
      <NavMain
        groupLabel="Monitor"
        items={[
          { title: "Monitors", url: "/monitors", icon: Globe },
          { title: "Incidents", url: "/incidents", icon: Siren },
        ]}
      />
    </SidebarProvider>,
  );

  const active = screen.getByRole("link", { name: "Monitors" });
  expect(active).toHaveAttribute("data-active", "true");
  expect(active.className).toContain("[&[data-active=true]>svg]:text-monitor");
  expect(screen.getByRole("link", { name: "Incidents" })).toHaveAttribute("data-active", "false");
});

it("lets an item override its group's area colour", () => {
  render(
    <SidebarProvider>
      <NavMain groupLabel="Monitor" items={[{ title: "Monitors", url: "/monitors", icon: Globe, tone: "ai" }]} />
    </SidebarProvider>,
  );
  expect(screen.getByRole("link", { name: "Monitors" }).className).toContain("[&[data-active=true]>svg]:text-ai");
});

it("gives Settings items no colour beyond the shared active style", () => {
  render(
    <SidebarProvider>
      <NavMain
        groupLabel="Settings"
        items={[
          { title: "Organization", url: "/org-admin", icon: Globe },
          { title: "Super Admin", url: "/super-admin", icon: Siren },
        ]}
      />
    </SidebarProvider>,
  );
  for (const name of ["Organization", "Super Admin"]) {
    expect(screen.getByRole("link", { name }).className).not.toMatch(/data-active=true\]>svg\]:text-/);
  }
  // The sidebar data must not set a tone on them either.
  const sidebar = readFileSync(join(__dirname, "app-sidebar.tsx"), "utf8");
  expect(sidebar).not.toMatch(/NAV\.(organization|superAdmin)\.tone/);
});
