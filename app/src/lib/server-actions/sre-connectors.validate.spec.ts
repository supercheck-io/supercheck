/** @jest-environment node */
const mockFindConnector = jest.fn();
const mockSet = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({
    userId: "u1",
    organizationId: "o1",
    project: { id: "p1", userRole: "org_owner" },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  ...jest.requireActual("@/lib/sre/sre-rate-limiter"),
  checkSreConnectorValidationRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("@/lib/sre/connectors", () => ({
  ...jest.requireActual("@/lib/sre/connectors"),
  assertEndpointAllowedForExecution: jest.fn(async () => undefined),
}));
jest.mock("@/utils/db", () => {
  const chain = { set: (...a: unknown[]) => { mockSet(...a); return chain; }, where: () => chain, values: () => chain, returning: async () => [] };
  const tx = { update: () => chain, insert: () => chain };
  return {
    db: {
      query: {
        externalConnectors: { findFirst: (...a: unknown[]) => mockFindConnector(...a) },
        externalConnectorCredentials: { findFirst: jest.fn(async () => ({ encryptedCredential: "enc" })) },
      },
      transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
});

import { validateSreConnector } from "./sre-connectors";

describe("validateSreConnector with a row of a removed type", () => {
  it("blocks it without sending a request", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    mockFindConnector.mockResolvedValue({
      id: "018f0000-0000-7000-8000-000000000004",
      type: "webhook",
      status: "configured",
      privateAgentId: null,
      config: { endpointUrl: "https://hooks.example.com/x" },
      outputLimits: {},
    });

    await validateSreConnector({ id: "018f0000-0000-7000-8000-000000000004" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastValidationStatus: "policy_blocked",
        lastValidationError: "This connector type is not supported",
      }),
    );
  });
});
