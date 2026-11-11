import { fireEvent, render, screen } from "@testing-library/react";

import { AREA_ACTIVE_ICON, AREA_TEXT, NAV } from "./nav-areas";
import { CommandSearch } from "@/components/ui/command-search";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));

Element.prototype.scrollIntoView = jest.fn();

describe("nav areas", () => {
  it("gives every destination its own icon and a known tone", () => {
    const entries = Object.values(NAV);
    expect(new Set(entries.map((e) => e.icon)).size).toBe(entries.length);
    for (const { tone } of entries) {
      expect(AREA_TEXT[tone]).toBe(`text-${tone}`);
      expect(AREA_ACTIVE_ICON[tone]).toContain(`text-${tone}`);
    }
  });

  it("puts settings pages on the settings tone and Copilot on AI", () => {
    expect(NAV.organization.tone).toBe("settings");
    expect(NAV.superAdmin.tone).toBe("settings");
    expect(NAV.copilot.tone).toBe("ai");
  });

  it("renders command palette entries with the registry icon colour", () => {
    render(<CommandSearch canInvestigateSre canConfigureSre />);
    fireEvent.click(screen.getByRole("button", { name: /open command menu/i }));
    for (const { title, tone } of [NAV.copilot, NAV.organization, NAV.statusPages, NAV.deliveryHistory, NAV.notifications]) {
      const svg = screen.getByText(title).parentElement!.querySelector("svg")!;
      expect(svg.getAttribute("class")).toContain(AREA_TEXT[tone]);
    }
  });
});
