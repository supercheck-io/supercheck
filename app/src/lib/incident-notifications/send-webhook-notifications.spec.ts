/** @jest-environment node */
const incident = {
  id: "incident-1",
  statusPageId: "page-1",
  name: "Outage",
  status: "investigating",
  impact: "major",
  body: "Down",
  deliverNotifications: true,
  createdAt: new Date(),
};
const statusPage = {
  id: "page-1",
  status: "published",
  allowWebhookSubscribers: true,
};

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      incidents: { findFirst: jest.fn(async () => incident) },
      statusPages: { findFirst: jest.fn(async () => statusPage) },
    },
    update: jest.fn(),
  },
}));
jest.mock("./resolve-subscribers", () => ({ resolveSubscribers: jest.fn() }));
jest.mock("@/lib/webhook-delivery.service", () => ({
  deliverWebhook: jest.fn(),
  shouldQuarantine: jest.fn(() => false),
}));

import { db } from "@/utils/db";
import { resolveSubscribers } from "./resolve-subscribers";
import { deliverWebhook } from "@/lib/webhook-delivery.service";
import { sendWebhookNotifications } from "./send-webhook-notifications";

beforeEach(() => {
  jest.clearAllMocks();
  (db.update as jest.Mock).mockReturnValue({
    set: () => ({ where: async () => undefined }),
  });
});

it("never delivers to a webhook subscriber that has not proven endpoint ownership", async () => {
  jest.mocked(resolveSubscribers).mockResolvedValue([
    {
      id: "subscriber-1",
      endpoint: "https://hooks.example.com/supercheck",
      webhookSecret: "0123456789abcdef",
      verifiedAt: null,
      quarantinedAt: null,
      purgeAt: null,
      webhookFailures: 0,
    },
  ] as never);

  const result = await sendWebhookNotifications("incident-1", "page-1");

  expect(result.sentCount).toBe(0);
  expect(deliverWebhook).not.toHaveBeenCalled();
});

it("delivers once the subscriber is verified", async () => {
  jest.mocked(resolveSubscribers).mockResolvedValue([
    {
      id: "subscriber-1",
      endpoint: "https://hooks.example.com/supercheck",
      webhookSecret: "0123456789abcdef",
      verifiedAt: new Date(),
      quarantinedAt: null,
      purgeAt: null,
      webhookFailures: 0,
    },
  ] as never);
  jest
    .mocked(deliverWebhook)
    .mockResolvedValue({ success: true, retriesAttempted: 0 });

  const result = await sendWebhookNotifications("incident-1", "page-1");

  expect(result.sentCount).toBe(1);
  expect(deliverWebhook).toHaveBeenCalledTimes(1);
});

describe("failure counting", () => {
  const sub = {
    id: "subscriber-1",
    endpoint: "https://hooks.example.com/supercheck",
    webhookSecret: "0123456789abcdef",
    verifiedAt: new Date(),
    quarantinedAt: null,
    purgeAt: null,
    webhookFailures: 3,
  };
  function captureSet() {
    const sets: Record<string, unknown>[] = [];
    (db.update as jest.Mock).mockReturnValue({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: async () => undefined };
      },
    });
    return sets;
  }

  it("does not count a retryable (non-final) attempt toward quarantine", async () => {
    jest.mocked(resolveSubscribers).mockResolvedValue([sub] as never);
    jest.mocked(deliverWebhook).mockResolvedValue({ success: false, error: "boom", retriesAttempted: 0 } as never);
    const sets = captureSet();
    await sendWebhookNotifications("incident-1", "page-1", undefined, "subscriber-1", false, false);
    expect(sets.every((s) => s.webhookFailures === undefined)).toBe(true);
  });

  it("counts the final attempt once", async () => {
    jest.mocked(resolveSubscribers).mockResolvedValue([sub] as never);
    jest.mocked(deliverWebhook).mockResolvedValue({ success: false, error: "boom", retriesAttempted: 0 } as never);
    const sets = captureSet();
    await sendWebhookNotifications("incident-1", "page-1", undefined, "subscriber-1", false, true);
    expect(sets[0].webhookFailures).toBe(4);
  });
});
