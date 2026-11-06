const sets: Array<Record<string, unknown>> = [];
let lockedStatus = "resolved";
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.set = (v: Record<string, unknown>) => (sets.push(v), c);
  c.values = () => c;
  c.where = () => c;
  c.for = async () => rows;
  c.returning = async () => rows;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r);
  return c;
};
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) },
      incidents: { findFirst: jest.fn(async () => ({ id: "i", sourceComponentId: null })) },
    },
    transaction: jest.fn(async (run: (tx: unknown) => unknown) =>
      run({
        select: () => ({ from: () => chain([{ status: lockedStatus }]) }),
        update: () => chain([{ id: "i", name: "n" }]),
        insert: () => chain([{ id: "u" }]),
        query: { incidentComponents: { findMany: async () => [] } },
      }),
    ),
  },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({ userId: "u", organizationId: "o", project: { id: "pr", name: "n" } })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn(async () => undefined) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
const repoint = jest.fn();
jest.mock("@/lib/status-page-reconciliation", () => ({ repointSreStatusPageSlot: (...a: unknown[]) => repoint(...a) }));
import { updateIncidentStatus } from "./update-incident-status";

const base = {
  incidentId: "00000000-0000-4000-8000-000000000001",
  statusPageId: "00000000-0000-4000-8000-000000000002",
  status: "investigating" as const,
  body: "Still looking",
  deliverNotifications: false,
  restoreComponentStatus: false,
};

beforeEach(() => {
  sets.length = 0;
  repoint.mockClear();
});

it("does not reopen an incident that resolved since the caller read it", async () => {
  lockedStatus = "resolved";
  const result = await updateIncidentStatus(base, { expectedStatus: "investigating" });
  expect(result).toMatchObject({ success: false });
  expect(sets).toHaveLength(0);
});

it("does not overwrite a newer non-resolved status with a stale one", async () => {
  lockedStatus = "monitoring";
  expect(await updateIncidentStatus(base, { expectedStatus: "investigating" })).toMatchObject({ success: false });
  expect(sets).toHaveLength(0);
});

it("posts normally when the incident is still open", async () => {
  lockedStatus = "investigating";
  expect((await updateIncidentStatus(base, { expectedStatus: "investigating" })).success).toBe(true);
});

it("keeps manual reopening available when the guard is not requested", async () => {
  lockedStatus = "resolved";
  expect((await updateIncidentStatus(base)).success).toBe(true);
});

it("re-points the SRE link slot when the incident resolves", async () => {
  lockedStatus = "investigating";
  await updateIncidentStatus({ ...base, status: "resolved" });
  expect(repoint).toHaveBeenCalledWith(expect.anything(), "i");
});
