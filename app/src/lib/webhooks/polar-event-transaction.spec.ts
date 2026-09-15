/** @jest-environment node */
jest.mock("@/utils/db", () => ({ db: { transaction: jest.fn() } }));

import { db } from "@/utils/db";
import {
  getPolarWebhookDb,
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

  it("fails closed on ambiguous timestamp ties", async () => {
    setup({
      polarWebhookTimestamp: at,
      polarWebhookEventKey: "different-event",
    });
    const apply = jest.fn();
    await expect(runOrderedPolarEvent(input, apply)).rejects.toThrow(
      "Ambiguous",
    );
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
});
