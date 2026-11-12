import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";

import { CommandSearch, COMMAND_NAV_SECTIONS } from "./command-search";
import { CREATE_ACTIONS, CREATE_GROUPS, createActionsFor } from "@/lib/create-actions";
import { AREA_TEXT, NAV } from "@/lib/nav-areas";

const mockAdmin = { isAdmin: true, isOrgAdmin: true };
jest.mock("@/hooks/use-admin-status", () => ({ useAdminStatus: () => mockAdmin }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
Element.prototype.scrollIntoView = jest.fn();

const all = {
  canInvestigateSre: true,
  canConfigureSre: true,
  canCreateProjects: true,
  canInviteMembers: true,
  canCreateCliTokens: true,
  canCreateSreServices: true,
  canConfigureSreConnectors: true,
};

function openPalette(props: Parameters<typeof CommandSearch>[0]) {
  render(<CommandSearch {...props} />);
  fireEvent.click(screen.getByRole("button", { name: /open command menu/i }));
  return Array.from(document.querySelectorAll("[cmdk-group]")).map((group) => ({
    heading: group.querySelector("[cmdk-group-heading]")!.textContent,
    items: Array.from(group.querySelectorAll("[cmdk-item]")).map((item) => ({
      title: item.textContent!,
      iconClass: item.querySelector("svg")?.getAttribute("class") ?? "",
    })),
  }));
}

describe("command palette", () => {
  beforeEach(() => Object.assign(mockAdmin, { isAdmin: true, isOrgAdmin: true }));

  it("orders groups like the sidebar, then Create like Quick Create", () => {
    const sidebar = [...readFileSync(join(__dirname, "../app-sidebar.tsx"), "utf8").matchAll(/groupLabel="(\w+)"/g)].map((m) => m[1]);
    const headings = openPalette(all).map((g) => g.heading);
    expect(headings).toEqual([...sidebar, ...CREATE_GROUPS.map((g) => g.heading)]);
    expect(sidebar).toEqual(["Respond", "Communicate", "Automate", "Monitor", "Settings"]);
  });

  it("shows every destination and create action once with its registry icon colour", () => {
    const groups = openPalette(all);
    const titles = groups.flatMap((g) => g.items.map((i) => `${g.heading}/${i.title}`));
    expect(new Set(titles).size).toBe(titles.length);

    for (const section of COMMAND_NAV_SECTIONS) {
      const group = groups.find((g) => g.heading === section.heading)!;
      expect(group.items.map((i) => i.title)).toEqual(section.items.map(({ id }) => NAV[id].title));
      for (const { id } of section.items) {
        expect(group.items.find((i) => i.title === NAV[id].title)!.iconClass).toContain(AREA_TEXT[NAV[id].tone]);
      }
    }
    for (const { id, heading } of CREATE_GROUPS) {
      const group = groups.find((g) => g.heading === heading)!;
      expect(group.items.map((i) => i.title)).toEqual(createActionsFor(id).map((a) => a.title));
      for (const action of createActionsFor(id)) {
        const item = group.items.find((i) => i.title === action.title)!;
        // Brand marks keep their own colour; everything else carries the registry class.
        if (action.text) expect(item.iconClass).toContain(action.text);
      }
    }
    expect(CREATE_ACTIONS.length).toBeGreaterThan(0);
  });

  it("hides gated entries from users who cannot use them", () => {
    Object.assign(mockAdmin, { isAdmin: false, isOrgAdmin: false });
    const groups = openPalette({});
    const titles = groups.flatMap((g) => g.items.map((i) => i.title));
    for (const hidden of ["Super Admin", "Organization", "Copilot", "Services", "Integrations", "Project", "Member", "CLI Token", "Service", "Private Agent"]) {
      expect(titles).not.toContain(hidden);
    }
    expect(groups.map((g) => g.heading)).not.toContain("Settings");
    expect(groups.map((g) => g.heading)).not.toContain("Configure AI SRE");
    expect(titles).toContain("Browser Test");
  });
});
