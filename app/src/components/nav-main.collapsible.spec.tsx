import { fireEvent, render, screen } from "@testing-library/react";
import { Globe } from "lucide-react";

import { NavMain } from "./nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";

jest.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ prefetch: jest.fn() }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: null }) }));
jest.mock("@/lib/prefetch-utils", () => ({ prefetchSidebarRoute: jest.fn() }));
jest.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

// jsdom ignores Tailwind classes, so assert on the group content's data-state (the closed class hides it).
const groupContent = (toggle: HTMLElement) =>
  toggle.closest("[data-slot=collapsible]")!.children[1];
const items = [{ title: "Monitors", url: "/monitors", icon: Globe }];
const renderGroup = (props = {}) =>
  render(<SidebarProvider><NavMain groupLabel="Monitor" items={items} {...props} /></SidebarProvider>);

it("has no toggle by default", () => {
  renderGroup();
  expect(screen.queryByRole("button", { name: /toggle monitor/i })).toBeNull();
  expect(screen.getByText("Monitors")).toBeVisible();
});

it("folds and unfolds a collapsible group while its label stays visible", () => {
  renderGroup({ collapsible: true, defaultOpen: false });
  const toggle = screen.getByRole("button", { name: /toggle monitor/i });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByText("Monitor")).toBeVisible();
  expect(groupContent(toggle)).toHaveAttribute("data-state", "closed");
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(groupContent(toggle)).toHaveAttribute("data-state", "open");
});

it("starts open when defaultOpen is true", () => {
  renderGroup({ collapsible: true, defaultOpen: true });
  expect(screen.getByRole("button", { name: /toggle monitor/i })).toHaveAttribute("aria-expanded", "true");
});
