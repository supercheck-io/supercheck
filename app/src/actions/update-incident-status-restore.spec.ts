const mockRestore = jest.fn();
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.set = () => c;
  c.values = () => c;
  c.where = () => c;
  c.returning = async () => rows;
  c.then = (r: (v: unknown) => unknown) => Promise.resolve(undefined).then(r);
  return c;
};
const mockLock = jest.fn(async () => []);
const lockChain: Record<string, unknown> = {};
for (const m of ["from", "where", "orderBy"]) lockChain[m] = () => lockChain;
lockChain.for = mockLock;
const tx = { update: () => chain([{ id: "i", name: "n" }]), insert: () => chain([{ id: "u" }]), select: () => lockChain };
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: { findFirst: jest.fn(async () => ({ id: "p" })) },
      incidents: { findFirst: jest.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001", statusPageId: "00000000-0000-4000-8000-000000000002", sourceComponentId: null })) },
    },
    transaction: jest.fn(async (run: (t: unknown) => unknown) => run(tx)),
  },
}));
jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(async () => ({
    userId: "user",
    organizationId: "00000000-0000-4000-8000-000000000002",
    project: { id: "00000000-0000-4000-8000-000000000003" },
  })),
}));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn(async () => undefined), checkPermissionWithContext: jest.fn(() => true) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/status-page-reconciliation", () => ({
  repointSreStatusPageSlot: jest.fn(),
  restoreResolvedIncidentComponents: (...args: unknown[]) => mockRestore(...args),
}));
import { updateIncidentStatus } from "./update-incident-status";

const base = {
  incidentId: "00000000-0000-4000-8000-000000000001",
  statusPageId: "00000000-0000-4000-8000-000000000002",
  status: "resolved" as const,
  body: "Fixed",
  deliverNotifications: false,
  restoreComponentStatus: true,
};

beforeEach(() => {
  mockRestore.mockReset();
  mockLock.mockClear();
});

it("restores through the shared reconciliation rules when resolving with the box ticked", async () => {
  expect((await updateIncidentStatus(base)).success).toBe(true);
  expect(mockRestore).toHaveBeenCalledWith(tx, base.incidentId, base.statusPageId);
  // Its components are locked before anything else, matching reconciliation's order.
  expect(mockLock).toHaveBeenCalledWith("update");
});

it("leaves components alone when the box is not ticked", async () => {
  expect((await updateIncidentStatus({ ...base, restoreComponentStatus: false })).success).toBe(true);
  expect(mockRestore).not.toHaveBeenCalled();
});

it("does not restore on a status other than resolved", async () => {
  expect((await updateIncidentStatus({ ...base, status: "monitoring" })).success).toBe(true);
  expect(mockRestore).not.toHaveBeenCalled();
});
