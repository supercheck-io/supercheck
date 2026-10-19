jest.mock("@/utils/db", () => ({ db: {
  query: { statusPageSubscribers: { findFirst: jest.fn() }, statusPages: { findFirst: jest.fn() } },
  update: jest.fn(),
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/email-service", () => ({ EmailService: jest.fn() }));
jest.mock("@/lib/email-renderer", () => ({ renderStatusPageVerificationEmail: jest.fn() }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { requirePermissions } from "@/lib/rbac/middleware";
import { rotateSubscriberWebhookSecret } from "./get-status-page-subscribers";
const id = "550e8400-e29b-41d4-a716-446655440000";
describe("webhook secret rotation", () => {
  const returning = jest.fn();
  const set = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (requireProjectContext as jest.Mock).mockResolvedValue({ organizationId: "org", project: { id: "project" } });
    (requirePermissions as jest.Mock).mockResolvedValue(undefined);
    (db.query.statusPageSubscribers.findFirst as jest.Mock).mockResolvedValue({ id, statusPageId: "page" });
    (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id: "page" });
    returning.mockResolvedValue([{ id }]);
    set.mockReturnValue({ where: jest.fn().mockReturnValue({ returning }) });
    (db.update as jest.Mock).mockReturnValue({ set });
  });
  it("returns the replacement once and requires update permission", async () => {
    const result = await rotateSubscriberWebhookSecret(id);
    expect(result.success).toBe(true);
    expect(result.webhookSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ webhookSecret: result.webhookSecret }));
    expect(requirePermissions).toHaveBeenCalledWith({ status_page: ["update"] }, { organizationId: "org", projectId: "project" });
  });
  it("does not update a subscriber outside the active project", async () => {
    (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue(null);
    expect((await rotateSubscriberWebhookSecret(id)).success).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not reveal a secret when the subscription was removed concurrently", async () => {
    returning.mockResolvedValue([]);
    expect(await rotateSubscriberWebhookSecret(id)).not.toHaveProperty("webhookSecret");
  });
  it("rejects invalid IDs before querying", async () => {
    expect((await rotateSubscriberWebhookSecret("invalid")).success).toBe(false);
    expect(db.query.statusPageSubscribers.findFirst).not.toHaveBeenCalled();
  });
});
