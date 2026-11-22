import { AREA_ACTIVE_ICON, AREA_TEXT, NAV } from "./nav-areas";
import { TYPE_TONE, TYPE_TONES } from "./type-tones";

describe("nav areas", () => {
  it("gives every destination its own icon and a known tone", () => {
    const entries = Object.values(NAV);
    expect(new Set(entries.map((e) => e.icon)).size).toBe(entries.length);
    for (const { tone } of entries) {
      const token = (TYPE_TONES as readonly string[]).includes(tone) ? `type-${tone}` : tone;
      expect(AREA_TEXT[tone]).toBe(`text-${token}`);
      expect(AREA_ACTIVE_ICON[tone]).toContain(`text-${token}`);
    }
  });

  it("gives Organization and Super Admin their own colours and Copilot AI", () => {
    expect(NAV.organization.tone).toBe("organization");
    expect(NAV.superAdmin.tone).toBe("superadmin");
    expect(NAV.copilot.tone).toBe("ai");
  });

  it("colours the Dashboard like the test types and Connected apps like the MCP monitor", () => {
    expect(NAV.dashboard.tone).toBe(TYPE_TONE.test.browser);
    expect(NAV.connectedApps.tone).toBe(TYPE_TONE.monitor.mcp_server);
  });

  it("takes AI SRE setup colours from the type registry", () => {
    expect(NAV.services.tone).toBe(TYPE_TONE.sre.service);
    expect(NAV.integrations.tone).toBe(TYPE_TONE.sre.integration);
    expect(NAV.privateAgents.tone).toBe(TYPE_TONE.sre.privateAgent);
  });
});
