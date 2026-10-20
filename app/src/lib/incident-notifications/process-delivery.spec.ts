const mockSetCalls: Array<Record<string, unknown>> = [];
const mockWhereCalls: unknown[] = [];
let mockLeased: Array<Record<string, unknown>> = [];

jest.mock("@/utils/db", () => {
  // update().set().where() settles; update().set().where().returning() leases.
  const update = jest.fn(() => ({
    set: jest.fn((values: Record<string, unknown>) => {
      mockSetCalls.push(values);
      const where = Promise.resolve(undefined) as Promise<undefined> & {
        returning: () => Promise<unknown[]>;
      };
      where.returning = async () => mockLeased;
      return {
        where: jest.fn((condition: unknown) => {
          mockWhereCalls.push(condition);
          return where;
        }),
      };
    }),
  }));
  return {
    db: {
      update,
      query: {
        statusPageNotificationEvents: { findFirst: jest.fn() },
        incidents: { findFirst: jest.fn() },
        incidentUpdates: { findFirst: jest.fn() },
      },
    },
  };
});
jest.mock("./resolve-subscribers", () => ({ resolveSubscribers: jest.fn() }));
jest.mock("./send-incident-notifications", () => ({
  sendIncidentNotifications: jest.fn(),
}));
jest.mock("./send-webhook-notifications", () => ({
  sendWebhookNotifications: jest.fn(),
}));
jest.mock("./send-slack-notifications", () => ({
  sendSlackNotifications: jest.fn(),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/utils/db";
import { processDelivery } from "./delivery-worker";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";

const queries = db.query as unknown as {
  statusPageNotificationEvents: { findFirst: jest.Mock };
  incidents: { findFirst: jest.Mock };
  incidentUpdates: { findFirst: jest.Mock };
};

const lease = (overrides: Record<string, unknown> = {}) => ({
  id: "delivery",
  eventId: "event",
  subscriberId: "subscriber",
  mode: "email",
  attempts: 1,
  ...overrides,
});

// First recorded write is the lease (attempts + 1); settle writes follow it.
const settled = () => mockSetCalls.slice(1);

beforeEach(() => {
  jest.clearAllMocks();
  mockSetCalls.length = 0;
  mockWhereCalls.length = 0;
  mockLeased = [lease()];
  queries.statusPageNotificationEvents.findFirst.mockResolvedValue({
    id: "event",
    incidentId: "incident",
    updateId: "update",
    isCreation: true,
  });
  queries.incidents.findFirst.mockResolvedValue({
    id: "incident",
    statusPageId: "page",
  });
  queries.incidentUpdates.findFirst.mockResolvedValue({ id: "update" });
  (sendIncidentNotifications as jest.Mock).mockResolvedValue({
    success: true,
    sentCount: 1,
  });
});

describe("processDelivery", () => {
  it("returns early when no delivery row could be leased", async () => {
    mockLeased = [];

    await processDelivery("delivery");

    expect(sendIncidentNotifications).not.toHaveBeenCalled();
    expect(settled()).toHaveLength(0);
  });

  it("records the lease by incrementing attempts and setting an expiry", async () => {
    await processDelivery("delivery");

    expect(mockSetCalls[0]).toEqual(
      expect.objectContaining({ attempts: expect.anything(), leasedUntil: expect.any(Date) }),
    );
  });

  it("keeps a delivery pending on the third failed attempt", async () => {
    mockLeased = [lease({ attempts: 3 })];
    (sendIncidentNotifications as jest.Mock).mockRejectedValue(new Error("down"));

    await expect(processDelivery("delivery")).rejects.toThrow("down");

    expect(settled()[0]).toEqual(expect.objectContaining({ status: "pending" }));
  });

  it("marks a successful send delivered and clears the lease", async () => {
    await processDelivery("delivery");

    expect(settled()).toEqual([
      expect.objectContaining({
        status: "delivered",
        lastError: null,
        leasedUntil: null,
      }),
    ]);
  });

  it("marks a delivery skipped when the subscriber is no longer eligible", async () => {
    (sendIncidentNotifications as jest.Mock).mockResolvedValue({
      success: true,
      sentCount: 0,
    });

    await processDelivery("delivery");

    expect(settled()[0]).toEqual(expect.objectContaining({ status: "skipped" }));
  });

  it.each([
    ["webhook", sendWebhookNotifications],
    ["slack", sendSlackNotifications],
  ])("routes %s deliveries to their sender with the creation flag", async (mode, sender) => {
    mockLeased = [lease({ mode })];
    (sender as jest.Mock).mockResolvedValue({ success: true, sentCount: 1 });

    await processDelivery("delivery");

    expect(sender).toHaveBeenCalledWith(
      "incident",
      "page",
      { id: "update" },
      "subscriber",
      true,
    );
    expect(sendIncidentNotifications).not.toHaveBeenCalled();
  });

  it("keeps a failed delivery pending for retry before the attempt limit", async () => {
    (sendIncidentNotifications as jest.Mock).mockResolvedValue({
      success: false,
      message: "smtp down",
    });

    await expect(processDelivery("delivery")).rejects.toThrow("smtp down");

    expect(settled()).toEqual([
      expect.objectContaining({
        status: "pending",
        lastError: "smtp down",
        leasedUntil: null,
      }),
    ]);
  });

  it("marks a delivery failed once the fourth attempt fails", async () => {
    mockLeased = [lease({ attempts: 4 })];
    (sendIncidentNotifications as jest.Mock).mockRejectedValue(
      new Error("x".repeat(2000)),
    );

    await expect(processDelivery("delivery")).rejects.toThrow();

    const [write] = settled();
    expect(write).toEqual(expect.objectContaining({ status: "failed" }));
    expect((write.lastError as string).length).toBe(1000);
  });

  it("records a generic error when a non-Error is thrown", async () => {
    (sendIncidentNotifications as jest.Mock).mockRejectedValue("boom");

    await expect(processDelivery("delivery")).rejects.toBe("boom");

    expect(settled()[0]).toEqual(
      expect.objectContaining({ lastError: "Delivery failed" }),
    );
  });

  it.each([
    ["event", () => queries.statusPageNotificationEvents.findFirst.mockResolvedValue(undefined)],
    ["incident", () => queries.incidents.findFirst.mockResolvedValue(undefined)],
    ["update", () => queries.incidentUpdates.findFirst.mockResolvedValue(undefined)],
  ])("settles the delivery as skipped when the %s was removed", async (_name, remove) => {
    remove();

    await processDelivery("delivery");

    expect(sendIncidentNotifications).not.toHaveBeenCalled();
    expect(settled()).toEqual([
      expect.objectContaining({
        status: "skipped",
        lastError: "Notification source no longer exists.",
        leasedUntil: null,
        enqueuedAt: null,
      }),
    ]);
  });
});

describe("processDelivery settle guard", () => {
  const render = (condition: unknown) =>
    new PgDialect().sqlToQuery(condition as SQL);

  it.each([
    ["success", () => undefined],
    [
      "failure",
      () =>
        (sendIncidentNotifications as jest.Mock).mockRejectedValue(
          new Error("down"),
        ),
    ],
  ])("scopes the %s write to the lease this worker took", async (name, arrange) => {
    mockLeased = [lease({ attempts: 2 })];
    arrange();

    await processDelivery("delivery").catch(() => undefined);

    // mockWhereCalls[0] is the lease; the settle write follows it.
    const { sql: text, params } = render(mockWhereCalls[1]);
    expect(text).toContain('"status"');
    expect(text).toContain('"attempts"');
    expect(params).toEqual(expect.arrayContaining(["delivery", "pending", 2]));
  });
});
