const sets: Array<Record<string, unknown>> = [];
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.set = (v: Record<string, unknown>) => (sets.push(v), c);
  c.values = () => c;
  c.where = () => c;
  c.returning = async () => rows;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r);
  return c;
};
const findMany = jest.fn();
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) },
      incidents: { findFirst: jest.fn(async () => ({ id: "i", sourceComponentId: null })) },
    },
    transaction: jest.fn(async (run: (tx: unknown) => unknown) =>
      run({
        update: () => chain([{ id: "i", name: "n" }]),
        insert: () => chain([{ id: "u" }]),
        query: { incidentComponents: { findMany: (...a: unknown[]) => findMany(...a) } },
      }),
    ),
  },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({
    userId: "user",
    organizationId: "00000000-0000-4000-8000-000000000002",
    project: { id: "00000000-0000-4000-8000-000000000003" },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn(async () => undefined) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));

import { updateIncidentStatus } from "./update-incident-status";

const base = {
  incidentId: "00000000-0000-4000-8000-000000000001",
  statusPageId: "00000000-0000-4000-8000-000000000002",
  status: "resolved" as const,
  body: "Fixed",
  deliverNotifications: false,
  restoreComponentStatus: true,
};

function run(others: Array<{ id: string; status: string }>) {
  sets.length = 0;
  findMany
    .mockResolvedValueOnce([{ componentId: "c1" }])
    .mockResolvedValueOnce(others.map((incident) => ({ incident })));
  return updateIncidentStatus(base);
}

it("restores the component when the only other incident is a not-yet-started maintenance", async () => {
  expect((await run([{ id: "m", status: "scheduled" }])).success).toBe(true);
  expect(sets.some((s) => s.status === "operational")).toBe(true);
});

it("keeps the component degraded while another incident is genuinely active", async () => {
  expect((await run([{ id: "x", status: "investigating" }])).success).toBe(true);
  expect(sets.some((s) => s.status === "operational")).toBe(false);
});
