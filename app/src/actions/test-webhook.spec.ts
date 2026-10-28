jest.mock("@/utils/db", () => ({ db: {
  query: { statusPageSubscribers: { findFirst: jest.fn() }, statusPages: { findFirst: jest.fn() } },
  update: jest.fn(),
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/webhook-delivery.service", () => ({ deliverWebhook: jest.fn() }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { deliverWebhook } from "@/lib/webhook-delivery.service";
import { testWebhook } from "./test-webhook";

const id = "550e8400-e29b-41d4-a716-446655440000";

it("clears quarantine when the admin test succeeds", async () => {
  (requireProjectContext as jest.Mock).mockResolvedValue({ userId: "u", organizationId: "org", project: { id: "p" } });
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id });
  (db.query.statusPageSubscribers.findFirst as jest.Mock).mockResolvedValue({
    id, mode: "webhook", endpoint: "https://example.com/h", webhookSecret: "s", quarantinedAt: new Date(),
  });
  (deliverWebhook as jest.Mock).mockResolvedValue({ success: true, statusCode: 200 });
  const set = jest.fn().mockReturnValue({ where: jest.fn() });
  (db.update as jest.Mock).mockReturnValue({ set });

  await testWebhook({ subscriberId: id, statusPageId: id });

  expect(set).toHaveBeenCalledWith(expect.objectContaining({ webhookFailures: 0, quarantinedAt: null }));
});
