/** @jest-environment node */
const mockDistinct = jest.fn();
const mockFindMany = jest.fn();
jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ checkPermissionWithContext: () => true }));
jest.mock("@/utils/db", () => {
  const rows = (data: unknown) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "where", "orderBy"]) chain[m] = () => chain;
    chain.then = (r: (x: unknown) => unknown) => Promise.resolve(data).then(r);
    return chain;
  };
  return {
    db: {
      select: jest.fn(() => rows([{ connector: { id: "c1", config: {}, outputLimits: {} } }])),
      selectDistinctOn: (...args: unknown[]) => {
        mockDistinct(...args);
        return rows([{ connectorId: "c1", id: "j1", status: "completed", createdAt: new Date(), completedAt: null, errorCode: null, resultHash: null, resultSummary: null }]);
      },
      query: { privateAgentJobs: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
    },
  };
});

import { getSreConnectors } from "./sre-connectors";

it("loads only the latest job per connector, without job_spec", async () => {
  const result = await getSreConnectors({ userId: "u", organizationId: "o", project: { id: "p" } } as never);
  expect(mockFindMany).not.toHaveBeenCalled();
  const [, columns] = mockDistinct.mock.calls[0];
  expect(Object.keys(columns)).not.toContain("jobSpec");
  expect(result).toMatchObject({ success: true, connectors: [{ latestPrivateAgentJob: { id: "j1" } }] });
});
