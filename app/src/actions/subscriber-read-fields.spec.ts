jest.mock("@/utils/db", () => ({ db: {
  query: {
    statusPageSubscribers: { findMany: jest.fn(), findFirst: jest.fn() },
    statusPages: { findFirst: jest.fn() },
  },
} }));
jest.mock("@/lib/project-context", () => ({ requireProjectContext: jest.fn() }));
jest.mock("@/lib/rbac/middleware", () => ({ requirePermissions: jest.fn() }));
jest.mock("@/lib/email-service", () => ({ EmailService: jest.fn() }));
jest.mock("@/lib/email-renderer", () => ({ renderStatusPageVerificationEmail: jest.fn() }));
import { db } from "@/utils/db";
import { requireProjectContext } from "@/lib/project-context";
import { getStatusPageSubscribers } from "./get-status-page-subscribers";
import { getSubscriberByToken } from "./unsubscribe-from-status-page";

const SENSITIVE = ["webhookSecret", "verificationToken", "unsubscribeToken"];
const pageId = "550e8400-e29b-41d4-a716-446655440000";

describe("subscriber reads never select secrets or tokens", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requireProjectContext as jest.Mock).mockResolvedValue({ organizationId: "org", project: { id: "project" } });
    (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({ id: pageId });
    (db.query.statusPageSubscribers.findMany as jest.Mock).mockResolvedValue([]);
  });

  it("getStatusPageSubscribers selects an explicit allow-list", async () => {
    await getStatusPageSubscribers(pageId);
    const args = (db.query.statusPageSubscribers.findMany as jest.Mock).mock.calls[0][0];
    expect(args.columns).toBeDefined();
    for (const key of SENSITIVE) expect(args.columns[key]).toBeUndefined();
    expect(args.columns).toEqual({
      id: true,
      email: true,
      endpoint: true,
      mode: true,
      verifiedAt: true,
      createdAt: true,
      updatedAt: true,
    });
  });

  it("getSubscriberByToken selects an explicit allow-list", async () => {
    (db.query.statusPageSubscribers.findFirst as jest.Mock).mockResolvedValue(null);
    await getSubscriberByToken("a".repeat(64));
    const args = (db.query.statusPageSubscribers.findFirst as jest.Mock).mock.calls[0][0];
    expect(args.columns).toBeDefined();
    for (const key of SENSITIVE) expect(args.columns[key]).toBeUndefined();
    expect(args.with.statusPage.columns).toEqual({ name: true, language: true });
  });

  it("masks Slack webhook URLs but leaves other endpoints intact", async () => {
    const slack = "https://hooks.slack.com/services/T000/B000/SECRETVALUE1234";
    const hook = "https://example.com/hook";
    (db.query.statusPageSubscribers.findMany as jest.Mock).mockResolvedValue([
      { id: "1", mode: "slack", endpoint: slack, email: null },
      { id: "2", mode: "webhook", endpoint: hook, email: null },
    ]);
    const result = await getStatusPageSubscribers(pageId);
    expect(result.subscribers[0].endpoint).toBe("hooks.slack.com/…1234");
    expect(JSON.stringify(result)).not.toContain("SECRETVALUE");
    expect(result.subscribers[1].endpoint).toBe(hook);
  });
});
