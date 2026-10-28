jest.mock("@/utils/db", () => ({
  db: {
    query: { statusPages: { findFirst: jest.fn() }, incidents: { findFirst: jest.fn() } },
    delete: jest.fn(),
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/incident-notifications/retire-orphaned-subscribers", () => ({ retireOrphanedSubscribers: jest.fn() }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { retireOrphanedSubscribers } from "@/lib/incident-notifications/retire-orphaned-subscribers";
import { deleteIncident } from "./delete-incident";

const id = "550e8400-e29b-41d4-a716-446655440000";

it("retires subscribers scoped only to the incident before deleting it", async () => {
  (requireProjectContext as jest.Mock).mockResolvedValue({ userId: "u", organizationId: "o", project: { id: "p", name: "P" } });
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id });
  (db.query.incidents.findFirst as jest.Mock).mockResolvedValue({ id, name: "n" });
  const order: string[] = [];
  (retireOrphanedSubscribers as jest.Mock).mockImplementation(async () => void order.push("retire"));
  (db.delete as jest.Mock).mockImplementation(() => (order.push("delete"), { where: jest.fn() }));

  await deleteIncident(id, id);

  expect(retireOrphanedSubscribers).toHaveBeenCalledWith({ incidentId: id });
  expect(order).toEqual(["retire", "delete"]);
});
