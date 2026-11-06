jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmail: jest.fn(async () => ({ success: true })) }) } }));
jest.mock("@/lib/email-renderer", () => ({ renderStatusPageVerificationEmail: jest.fn(async () => ({ subject: "s", text: "t", html: "h" })) }));
jest.mock("@/lib/status-page-subscription-rate-limit", () => ({ allowStatusPageSubscription: jest.fn(async () => true) }));
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Headers()) }));
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPages: {
        findFirst: jest.fn(),
      },
      statusPageSubscribers: {
        findFirst: jest.fn(),
      },
    },
    delete: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/webhook-utils", () => ({
  generateWebhookSecret: jest.fn(() => "test-webhook-secret"),
}));

jest.mock("@/lib/incident-notifications/webhook-verification", () => ({
  sendWebhookChallenge: jest.fn(async () => ({ verified: true })),
}));

import { db } from "@/utils/db";
import { subscribeToStatusPage } from "./subscribe-to-status-page";

const mockDb = db as jest.Mocked<typeof db>;

describe("subscribeToStatusPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (
      mockDb.query.statusPages.findFirst as unknown as jest.Mock
    ).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000123",
      status: "published",
      allowPageSubscribers: true,
      allowIncidentSubscribers: false,
      allowEmailSubscribers: true,
      allowWebhookSubscribers: true,
      allowSlackSubscribers: true,
      name: "Test Status Page",
      subdomain: "test",
    } as never);

    (
      mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock
    ).mockResolvedValue(null);

    (mockDb.delete as jest.Mock).mockImplementation(() => ({
      where: jest.fn().mockResolvedValue(undefined),
    }));

    (mockDb.insert as jest.Mock).mockImplementation(() => ({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([
          {
            id: "00000000-0000-4000-8000-000000000999",
          },
        ]),
      }),
    }));
  });

  it("allows non-incident webhook subscriptions when incident subscribers are disabled", async () => {
    const result = await subscribeToStatusPage({
      statusPageId: "00000000-0000-4000-8000-000000000123",
      subscriptionMode: "webhook",
      endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true,
      subscribeToAllIncidents: false,
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("Webhook subscription verified");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("blocks explicit incident-interest subscriptions when incident subscribers are disabled", async () => {
    const result = await subscribeToStatusPage({
      statusPageId: "00000000-0000-4000-8000-000000000123",
      subscriptionMode: "webhook",
      endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true,
      subscribeToAllIncidents: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe(
      "Incident subscriptions are disabled for this status page"
    );
    expect(mockDb.query.statusPageSubscribers.findFirst).not.toHaveBeenCalled();
  });

  describe.each([
    ["webhook", "https://example.com/webhooks/status"],
    ["slack", "https://hooks.slack.com/services/T/B/x"],
  ])("resubscribing an existing %s endpoint", (mode, endpoint) => {
    let set: jest.Mock;
    beforeEach(() => {
      set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue(Object.assign(Promise.resolve(undefined), { returning: async () => [{ id: "x" }] })) });
      (mockDb.update as jest.Mock).mockReturnValue({ set });
    });
    const subscribe = () =>
      subscribeToStatusPage({
        statusPageId: "00000000-0000-4000-8000-000000000123",
        subscriptionMode: mode as "webhook" | "slack",
        endpoint,
        subscribeToAllComponents: true,
        subscribeToAllIncidents: false,
      });
    const existing = (o: Record<string, unknown>) =>
      (mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock).mockResolvedValue({
        id: "00000000-0000-4000-8000-000000000777", mode, endpoint, verifiedAt: new Date(),
        purgeAt: null, quarantinedAt: null, ...o,
      });

    it("clears quarantine and the failure counter", async () => {
      existing({ quarantinedAt: new Date() });
      const result = await subscribe();
      expect(result.success).toBe(true);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ quarantinedAt: null, webhookFailures: 0 }));
      if (mode === "webhook") expect(set).toHaveBeenCalledWith(expect.objectContaining({ verifiedAt: null }));
    });

    it("reactivates a row inside its unsubscribe grace period", async () => {
      existing({ purgeAt: new Date(Date.now() + 86400000) });
      const result = await subscribe();
      expect(result.success).toBe(true);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ purgeAt: null }));
    });

    it("still reports an active, healthy endpoint as already subscribed", async () => {
      existing({});
      expect((await subscribe()).success).toBe(false);
      expect(set).not.toHaveBeenCalled();
    });
  });

  it("tells an already verified email subscriber where to manage the subscription", async () => {
    (mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000777", email: "a@example.com", mode: "email",
      verifiedAt: new Date(), purgeAt: null,
    });
    const result = await subscribeToStatusPage({
      statusPageId: "00000000-0000-4000-8000-000000000123",
      subscriptionMode: "email",
      email: "a@example.com",
      subscribeToAllComponents: true,
      subscribeToAllIncidents: false,
    });
    expect(result.message).toMatch(/unsubscribe link/i);
  });
});

describe("public subscribe hardening", () => {
  const pageId = "00000000-0000-4000-8000-000000000123";
  const row = (o: Record<string, unknown>) =>
    (mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock).mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000777", verifiedAt: null, purgeAt: null, quarantinedAt: null, ...o,
    });
  let set: jest.Mock;
  let claimedRows: unknown[];
  beforeEach(() => {
    jest.clearAllMocks();
    (mockDb.query.statusPages.findFirst as unknown as jest.Mock).mockResolvedValue({
      id: pageId, status: "published", allowPageSubscribers: true, allowIncidentSubscribers: false,
      allowEmailSubscribers: true, allowWebhookSubscribers: true, allowSlackSubscribers: true, name: "P", subdomain: "p",
    });
    claimedRows = [{ id: "x" }];
    set = jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue(Object.assign(Promise.resolve(undefined), { returning: async () => claimedRows })) });
    (mockDb.update as jest.Mock).mockReturnValue({ set });
  });

  const email = () =>
    subscribeToStatusPage({ statusPageId: pageId, subscriptionMode: "email", email: "a@example.com", subscribeToAllComponents: true, subscribeToAllIncidents: false });

  it("does not rotate the token of a pending email subscriber again within the cooldown", async () => {
    row({ mode: "email", email: "a@example.com", updatedAt: new Date() });
    claimedRows = []; // the atomic UPDATE ... WHERE updated_at < cutoff matched nothing
    const result = await email();
    expect(result).toMatchObject({ success: true, requiresVerification: true });
    expect(result.message).toMatch(/sent recently/);
  });

  it("resends the verification email once the cooldown has passed", async () => {
    row({ mode: "email", email: "a@example.com", updatedAt: new Date(Date.now() - 10 * 60_000) });
    expect((await email()).success).toBe(true);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ verificationTokenHash: expect.any(String) }));
  });

  it("rotates the signing secret and returns it when an existing webhook row is re-subscribed", async () => {
    row({ mode: "webhook", endpoint: "https://example.com/webhooks/status" });
    const result = await subscribeToStatusPage({
      statusPageId: pageId, subscriptionMode: "webhook", endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true, subscribeToAllIncidents: false,
    });
    expect(result).toMatchObject({ success: true, webhookSecret: "test-webhook-secret" });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ webhookSecretEncrypted: expect.any(String), verifiedAt: null }));
  });

  it("does not rotate the secret of a webhook row submitted within the cooldown", async () => {
    row({ mode: "webhook", endpoint: "https://example.com/webhooks/status", updatedAt: new Date() });
    claimedRows = [];
    const result = await subscribeToStatusPage({
      statusPageId: pageId, subscriptionMode: "webhook", endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true, subscribeToAllIncidents: false,
    });
    expect(result.success).toBe(false);
    expect(result.webhookSecret).toBeUndefined();
  });

  it.each([
    ["quarantined", { quarantinedAt: new Date(), verifiedAt: new Date() }],
    ["unsubscribed (grace period)", { purgeAt: new Date(Date.now() + 86400000), verifiedAt: new Date() }],
  ])("keeps the stored secret and returns none for a %s webhook row", async (_n, over) => {
    row({ mode: "webhook", endpoint: "https://example.com/webhooks/status", ...over });
    const result = await subscribeToStatusPage({
      statusPageId: pageId, subscriptionMode: "webhook", endpoint: "https://example.com/webhooks/status",
      subscribeToAllComponents: true, subscribeToAllIncidents: false,
    });
    expect(result.success).toBe(true);
    expect(result.webhookSecret).toBeUndefined();
    const written = set.mock.calls[0][0];
    expect(written).not.toHaveProperty("webhookSecretEncrypted");
    expect(written).toMatchObject({ verifiedAt: null, purgeAt: null, quarantinedAt: null });
  });

  it("looks webhook rows up by mode, so a Slack row with the same URL is never touched", async () => {
    row({ mode: "slack", endpoint: "https://hooks.slack.com/services/T/B/x" });
    await subscribeToStatusPage({
      statusPageId: pageId, subscriptionMode: "webhook", endpoint: "https://hooks.slack.com/services/T/B/x",
      subscribeToAllComponents: true, subscribeToAllIncidents: false,
    });
    const lookup = (mockDb.query.statusPageSubscribers.findFirst as unknown as jest.Mock).mock.calls[0][0];
    const seen: unknown[] = [];
    const eqFn = (col: unknown, val: unknown) => (seen.push(val), {});
    lookup.where({ statusPageId: 1, endpoint: 2, mode: 3 }, { and: () => ({}), eq: eqFn });
    expect(seen).toContain("webhook");
  });

  it.each(["https://evil.slack.com/services/T/B/x", "https://hooks.slack.com.evil.com/x", "http://hooks.slack.com/services/T/B/x"])(
    "rejects the non-hooks Slack endpoint %s",
    async (endpoint) => {
      const result = await subscribeToStatusPage({
        statusPageId: pageId, subscriptionMode: "slack", endpoint, subscribeToAllComponents: true, subscribeToAllIncidents: false,
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/hooks\.slack\.com/);
    },
  );
});
