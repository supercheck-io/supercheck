/** @jest-environment node */
const mockImpersonated = jest.fn();
const mockCan = jest.fn();
const mockTransaction = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/private-agents/registration-token", () => ({ buildPrivateAgentRegistrationMetadata: jest.fn(() => ({})) }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: (...a: unknown[]) => mockCan(...a),
  isImpersonatedSession: (...a: unknown[]) => mockImpersonated(...a),
}));
jest.mock("@/utils/db", () => ({ db: { transaction: (...a: unknown[]) => mockTransaction(...a) } }));

import { registerPrivateAgent } from "./private-agents";

beforeEach(() => {
  jest.clearAllMocks();
  mockCan.mockReturnValue(true);
  mockImpersonated.mockResolvedValue(false);
});

describe("registerPrivateAgent", () => {
  it("refuses while a super admin is impersonating, before creating anything", async () => {
    mockImpersonated.mockResolvedValue(true);
    const result = await registerPrivateAgent({ name: "edge-1", projectScoped: true });
    expect(result.success).toBe(false);
    expect(String((result as { error?: string }).error)).toMatch(/impersonating/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("still enforces the connector permission first", async () => {
    mockCan.mockReturnValue(false);
    const result = await registerPrivateAgent({ name: "edge-1", projectScoped: true });
    expect(String((result as { error?: string }).error)).toMatch(/Insufficient permissions/);
    expect(mockImpersonated).not.toHaveBeenCalled();
  });
});
