/** @jest-environment node */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(() => true),
}));

jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
  },
}));

import { requireProjectContext } from "@/lib/project-context";
import { db } from "@/utils/db";
import { createSreDiagnosticQuery } from "./sre-diagnostic-queries";

describe("SRE diagnostic query actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireProjectContext).mockResolvedValue({
      userId: "018f0000-0000-7000-8000-000000000001",
      organizationId: "018f0000-0000-7000-8000-000000000002",
      project: {
        id: "018f0000-0000-7000-8000-000000000003",
        name: "Production",
        organizationId: "018f0000-0000-7000-8000-000000000002",
      },
    } as never);
  });

  it("rejects a recipe for a disabled connector", async () => {
    const limit = jest.fn().mockResolvedValue([
      {
        id: "018f0000-0000-7000-8000-000000000004",
        type: "prometheus",
        status: "disabled",
      },
    ]);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    jest.mocked(db.select).mockReturnValue({ from } as never);

    const result = await createSreDiagnosticQuery({
      connectorId: "018f0000-0000-7000-8000-000000000004",
      name: "Checkout latency",
      queryType: "promql",
      template: "up",
      parameterSchema: {},
      allowlist: { metrics: ["up"] },
      maxRows: 100,
      maxBytes: 1_048_576,
      maxSeconds: 10,
    });

    expect(result).toEqual({
      success: false,
      error: "Enable or replace this connector before adding a diagnostic recipe",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });
});
