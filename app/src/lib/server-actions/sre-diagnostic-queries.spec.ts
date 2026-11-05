/** @jest-environment node */
const mockSelectResults: unknown[][] = [];
const mockInsert = jest.fn();

jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u1", organizationId: "o1", project: { id: "p1", userRole: "org_owner" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/utils/db", () => {
  const chain = () => {
    const n: Record<string, unknown> = {};
    n.from = () => n;
    n.where = () => n;
    n.limit = async () => mockSelectResults.shift() ?? [];
    return n;
  };
  return { db: { select: () => chain(), insert: (...a: unknown[]) => mockInsert(...a) } };
});

import { createSreDiagnosticQuery } from "./sre-diagnostic-queries";

const input = {
  connectorId: "018f0000-0000-7000-8000-0000000000c1",
  name: "Checkout errors",
  queryType: "promql" as const,
  template: 'sum(rate(http_requests_total{service="$service"}[5m]))',
  parameterSchema: { service: "string" },
  allowlist: { service: ["checkout"] },
  maxRows: 100,
  maxBytes: 1_048_576,
  maxSeconds: 10,
};

it("rejects a second active saved query with the same name on a connector", async () => {
  mockSelectResults.push([{ id: input.connectorId, type: "prometheus", status: "valid" }], [{ id: "existing" }]);
  const result = await createSreDiagnosticQuery(input);
  expect(result).toMatchObject({ success: false, error: expect.stringContaining("already has a saved query") });
  expect(mockInsert).not.toHaveBeenCalled();
});
