/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));

jest.mock("@/lib/logger/index", () => {
  const logger = { error: jest.fn() };
  return { createLogger: () => logger, __logger: logger };
});

import { db } from "@/utils/db";
import * as loggerModule from "@/lib/logger/index";
import {
  getPolarWebhookDb,
  getPolarWebhookOrganizationId,
  runOrderedPolarEvent,
} from "./polar-event-transaction";

const at = new Date("2026-09-07T10:00:00Z");
const input = {
  organizationId: "org-1",
  timestamp: at,
  eventKey: "subscription.active:event-1",
  subscriptionId: "sub-1",
  canReplaceSubscription: true,
  periodStart: new Date("2026-09-01T00:00:00Z"),
};

function setup(overrides: Record<string, unknown> = {}) {
  const locked = jest.fn().mockResolvedValue([
    {
      id: "org-1",
      subscriptionId: "sub-1",
      usagePeriodStart: input.periodStart,
      polarWebhookTimestamp: null,
      polarWebhookEventKey: null,
      polarRetiredSubscriptionIds: [],
      ...overrides,
    },
  ]);
  const where = jest.fn().mockResolvedValue(undefined);
  const set = jest.fn().mockReturnValue({ where });
  const tx = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ for: locked }),
      }),
    }),
    update: jest.fn().mockReturnValue({ set }),
  };
  (db.transaction as jest.Mock).mockImplementation(async (callback) =>
    callback(tx),
  );
  return { tx, locked, set };
}

describe("Polar event transactions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("acknowledges an event whose organization was deleted while it waited, and fails otherwise", async () => {
    const { locked } = setup();
    const apply = jest.fn();
    locked.mockResolvedValueOnce([]);
    await expect(runOrderedPolarEvent({ ...input, organizationDeleted: async () => true }, apply)).resolves.toBeUndefined();
    locked.mockResolvedValueOnce([]);
    await expect(runOrderedPolarEvent({ ...input, organizationDeleted: async () => false }, apply)).rejects.toThrow("Polar billing organization not found");
    expect(apply).not.toHaveBeenCalled();
  });

  it("locks before invoking the handler and writes the cursor afterward", async () => {
    const { tx, locked, set } = setup();
    await runOrderedPolarEvent(input, async () => {
      expect(locked).toHaveBeenCalledWith("update");
      expect(set).not.toHaveBeenCalled();
      expect(getPolarWebhookDb("org-1")).toBe(tx);
      expect(() => getPolarWebhookDb("org-other")).toThrow(
        "conflicting organizations",
      );
    });
    expect(set).toHaveBeenCalledWith({
      polarWebhookTimestamp: at,
      polarWebhookEventKey: input.eventKey,
    });
    expect(getPolarWebhookDb()).toBe(db);
  });

  it.each(["older", "duplicate"])(
    "ignores %s events without running their handler",
    async (kind) => {
      const { set } = setup({
        polarWebhookTimestamp:
          kind === "older" ? new Date(at.getTime() + 1000) : at,
        polarWebhookEventKey: input.eventKey,
      });
      const apply = jest.fn();
      await runOrderedPolarEvent(input, apply);
      expect(apply).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    },
  );

  it("applies a paired event tied on the bound subscription", async () => {
    const { set } = setup({
      polarWebhookTimestamp: at,
      polarWebhookEventKey: "subscription.updated:event-0",
      subscriptionStatus: "canceled",
      subscriptionPlan: "plus",
    });
    const apply = jest.fn();
    await runOrderedPolarEvent(
      { ...input, snapshot: { status: "canceled", plan: "plus" } },
      apply,
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      polarWebhookTimestamp: at,
      polarWebhookEventKey: input.eventKey,
    });
  });

  it.each([
    ["another subscription", { subscriptionId: "sub-2" }],
    ["a customer event", { subscriptionId: null }],
    ["an active snapshot after revocation", { snapshot: { status: "active", plan: "plus" } }],
    ["a different plan", { snapshot: { status: "none", plan: null }, orgStatus: "active" }],
    ["an unknown status", { snapshot: { status: undefined, plan: "plus" } }],
    ["a missing snapshot", {}],
  ])("fails closed on timestamp ties for %s", async (_, { orgStatus, ...overrides }: Record<string, unknown>) => {
    setup({
      polarWebhookTimestamp: at,
      polarWebhookEventKey: "different-event",
      subscriptionStatus: orgStatus ?? "none",
      subscriptionPlan: orgStatus ? "plus" : null,
    });
    const apply = jest.fn();
    await expect(
      runOrderedPolarEvent({ ...input, ...overrides }, apply),
    ).rejects.toThrow("Ambiguous");
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when the handler fails", async () => {
    const { set } = setup();
    await expect(
      runOrderedPolarEvent(input, async () => {
        throw new Error("ledger write failed");
      }),
    ).rejects.toThrow("ledger write failed");
    expect(set).not.toHaveBeenCalled();
    expect(getPolarWebhookDb()).toBe(db);
  });

  it("records replaced subscriptions durably", async () => {
    const { set } = setup({ subscriptionId: "old-sub" });
    await runOrderedPolarEvent(input, async () => {});
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ polarRetiredSubscriptionIds: ["old-sub"] }),
    );
  });

  it.each(["active", "past_due"])("raises an alert when a replacement binds over a %s subscription", async (subscriptionStatus) => {
    setup({ subscriptionId: "old-subscription-id", subscriptionStatus });
    await runOrderedPolarEvent({ ...input, subscriptionId: "new-subscription-id" }, async () => {});
    const { __logger } = loggerModule as unknown as { __logger: { error: jest.Mock } };
    expect(__logger.error).toHaveBeenCalledWith(
      { organizationId: "org-1", replacedSubscriptionId: "old-subs", newSubscriptionId: "new-subs" },
      "Active subscription replaced another active subscription; check for duplicate billing",
    );
  });

  it.each([["canceled", "old-sub"], ["none", "old-sub"], ["active", "sub-1"]])("does not alert for a %s binding replaced by %s", async (subscriptionStatus, bound) => {
    setup({ subscriptionId: bound, subscriptionStatus });
    await runOrderedPolarEvent(input, async () => {});
    const { __logger } = loggerModule as unknown as { __logger: { error: jest.Mock } };
    expect(__logger.error).not.toHaveBeenCalled();
  });

  it("does not let payment timestamps suppress subscription lifecycle events", async () => {
    const { set } = setup();
    const apply = jest.fn();
    await runOrderedPolarEvent(
      { ...input, affectsSubscriptionState: false },
      apply,
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects replacement subscriptions with an older billing period", async () => {
    setup({
      subscriptionId: "newer-sub",
      usagePeriodStart: new Date("2026-10-01T00:00:00Z"),
    });
    await expect(runOrderedPolarEvent(input, jest.fn())).rejects.toThrow(
      "current billing period",
    );
  });

  it("ignores later events from retired subscriptions", async () => {
    setup({
      subscriptionId: "new-sub",
      polarRetiredSubscriptionIds: ["sub-1"],
    });
    const apply = jest.fn();
    await runOrderedPolarEvent(input, apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it("does not let an update or payment replace a subscription binding", async () => {
    setup({ subscriptionId: "other-sub" });
    await expect(
      runOrderedPolarEvent(
        { ...input, canReplaceSubscription: false },
        jest.fn(),
      ),
    ).rejects.toThrow("replacement subscription.active");
  });

  it.each([undefined, "invalid"])(
    "rejects an invalid timestamp (%s) before touching billing state",
    async (timestamp) => {
      setup();
      await expect(
        runOrderedPolarEvent({ ...input, timestamp }, jest.fn()),
      ).rejects.toThrow("valid provider timestamp");
      expect(db.transaction).not.toHaveBeenCalled();
    },
  );
  describe("a cancel or revoke for a subscription the organization does not hold", () => {
    const early = { ...input, canReplaceSubscription: false, subscriptionId: "sub-x", eventKey: "subscription.canceled:e2" };
    const held = { subscriptionId: "sub-held", polarRetiredSubscriptionIds: ["sub-old"] };

    it("fails retryably while the event is fresh, so the activation can land first", async () => {
      const { set } = setup(held);
      const apply = jest.fn();
      await expect(runOrderedPolarEvent({ ...early, ignoreWhenReplaced: { retry: true } }, apply))
        .rejects.toMatchObject({ name: "Error", message: "Waiting for replacement subscription.active event" });
      expect(apply).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
    });

    it("acknowledges an old one, retires the subscription and logs it", async () => {
      const { set } = setup(held);
      const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      const apply = jest.fn();
      await expect(runOrderedPolarEvent({ ...early, ignoreWhenReplaced: { retry: false } }, apply)).resolves.toBeUndefined();
      expect(apply).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({ polarRetiredSubscriptionIds: ["sub-old", "sub-x"] });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("retiring it"));
      warn.mockRestore();
    });
  });

  it("exposes the organization of the running event, and nothing outside one", async () => {
    expect(getPolarWebhookOrganizationId()).toBeUndefined();
    setup();
    let seen: string | undefined;
    await runOrderedPolarEvent(input, async () => { seen = getPolarWebhookOrganizationId(); });
    expect(seen).toBe("org-1");
  });
});
