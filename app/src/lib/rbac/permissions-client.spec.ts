import { Role, canInvestigateWithSreCopilot, canUseSreLiveConnectors } from "./permissions-client";

describe("AI SRE client permission helpers", () => {
  it("allows Copilot investigation for editors and admins, but not viewers", () => {
    expect(canInvestigateWithSreCopilot(Role.PROJECT_ADMIN)).toBe(true);
    expect(canInvestigateWithSreCopilot(Role.PROJECT_EDITOR)).toBe(true);
    expect(canInvestigateWithSreCopilot(Role.PROJECT_VIEWER)).toBe(false);
    expect(canInvestigateWithSreCopilot(undefined)).toBe(false);
  });

  it("allows live connector tools only for roles with connector investigate permission", () => {
    expect(canUseSreLiveConnectors(Role.PROJECT_ADMIN)).toBe(true);
    expect(canUseSreLiveConnectors(Role.ORG_OWNER)).toBe(true);
    expect(canUseSreLiveConnectors(Role.PROJECT_EDITOR)).toBe(false);
    expect(canUseSreLiveConnectors(Role.PROJECT_VIEWER)).toBe(false);
  });
});
