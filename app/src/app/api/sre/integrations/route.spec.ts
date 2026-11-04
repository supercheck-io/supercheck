/** @jest-environment node */
import { GET } from "./route";

const mockCanView = jest.fn();
const mockConnectors = jest.fn();
const mockBindings = jest.fn();
jest.mock("../_auth", () => ({
  requireSreApiPermissions: jest.fn(async () => ({
    success: true,
    context: { organizationId: "org-1", userId: "user-1", project: { id: "project-1" } },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...args: unknown[]) => mockCanView(...args),
}));
jest.mock("@/lib/server-actions/sre-connectors", () => ({
  getSreConnectors: (...a: unknown[]) => mockConnectors(...a),
  getSreConnectorSetupOptions: async () => ({ success: true, options: { services: [], privateAgents: [] } }),
}));
jest.mock("@/lib/server-actions/sre-integration-bindings", () => ({
  getSreIntegrationBindings: (...a: unknown[]) => mockBindings(...a),
  getSreIntegrationBindingSetupOptions: async () => ({ success: true, options: {} }),
}));

describe("GET /api/sre/integrations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockConnectors.mockResolvedValue({ success: true, connectors: [{ id: "c1" }] });
  });

  it("returns connectors without notification:view and skips bindings", async () => {
    mockCanView.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).connectors).toEqual([{ id: "c1" }]);
    expect(mockBindings).not.toHaveBeenCalled();
  });

  it("returns 500 when a loader throws", async () => {
    mockCanView.mockReturnValue(true);
    mockConnectors.mockRejectedValue(new Error("db down"));
    const response = await GET();
    expect(response.status).toBe(500);
  });
});
