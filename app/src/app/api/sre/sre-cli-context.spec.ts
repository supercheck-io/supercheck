/** @jest-environment node */

const cliContext = {
  userId: "user-1",
  organizationId: "org-1",
  project: { id: "project-1", name: "Project" },
  isCliAuth: true,
};

jest.mock("./_auth", () => ({
  requireSreApiPermissions: jest.fn(async () => ({
    success: true,
    context: cliContext,
  })),
}));
jest.mock("@/actions/sre-connectors", () => ({
  getSreConnectors: jest.fn(async () => ({ success: true, connectors: [] })),
  getSreConnectorSetupOptions: jest.fn(async () => ({
    success: true,
    options: { services: [], privateAgents: [] },
  })),
}));
jest.mock("@/actions/sre-integration-bindings", () => ({
  getSreIntegrationBindings: jest.fn(async () => ({
    success: true,
    bindings: [],
  })),
  getSreIntegrationBindingSetupOptions: jest.fn(async () => ({
    success: true,
    options: { notificationProviders: [], connectors: [], services: [] },
  })),
}));
jest.mock("@/actions/sre-diagnostic-queries", () => ({
  getSreDiagnosticQueries: jest.fn(async () => ({
    success: true,
    queries: [],
  })),
  getSreDiagnosticQuerySetupOptions: jest.fn(async () => ({
    success: true,
    options: { connectors: [] },
  })),
}));
jest.mock("@/actions/private-agents", () => ({
  getPrivateAgents: jest.fn(async () => ({ success: true, agents: [] })),
}));
jest.mock("@/actions/sre-onboarding", () => ({
  getSreOnboardingStatus: jest.fn(async () => ({
    success: true,
    status: { complete: false },
  })),
}));

import { GET as getIntegrations } from "./integrations/route";
import { GET as getDiagnosticRecipes } from "./diagnostic-recipes/route";
import { GET as getPrivateAgentsRoute } from "./private-agents/route";
import { GET as getOnboarding } from "./onboarding/route";

describe("SRE API CLI context", () => {
  it("passes the authenticated CLI context into every read action", async () => {
    const responses = await Promise.all([
      getIntegrations(),
      getDiagnosticRecipes(),
      getPrivateAgentsRoute(),
      getOnboarding(),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    for (const moduleName of [
      "@/actions/sre-connectors",
      "@/actions/sre-integration-bindings",
      "@/actions/sre-diagnostic-queries",
      "@/actions/private-agents",
      "@/actions/sre-onboarding",
    ]) {
      const actionModule = jest.requireMock(moduleName) as Record<
        string,
        jest.Mock
      >;
      for (const action of Object.values(actionModule)) {
        expect(action).toHaveBeenCalledWith(cliContext);
      }
    }
  });
});
