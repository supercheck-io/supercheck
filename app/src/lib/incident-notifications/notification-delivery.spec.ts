jest.mock("@/utils/db", () => ({
  db: {
    query: {
      incidents: { findFirst: jest.fn() },
      statusPages: { findFirst: jest.fn() },
      incidentComponents: { findMany: jest.fn() },
    },
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn() })) })),
  },
}));
jest.mock("./resolve-subscribers", () => ({ resolveSubscribers: jest.fn() }));
jest.mock("@/lib/webhook-delivery.service", () => ({
  deliverWebhook: jest.fn(),
  shouldQuarantine: jest.fn(),
}));
jest.mock("@/lib/slack-delivery.service", () => ({
  deliverSlackMessage: jest.fn(),
  shouldQuarantine: jest.fn(),
}));
jest.mock("@/lib/email-service", () => ({
  EmailService: { getInstance: () => ({ sendEmail: mockSendEmail }) },
}));
jest.mock("@/lib/email-renderer", () => ({
  renderIncidentNotificationEmail: jest.fn(async () => ({
    subject: "incident",
    text: "update",
    html: "update",
  })),
}));

import { db } from "@/utils/db";
import { resolveSubscribers } from "./resolve-subscribers";
import { deliverWebhook } from "@/lib/webhook-delivery.service";
import { deliverSlackMessage } from "@/lib/slack-delivery.service";
import { renderIncidentNotificationEmail } from "@/lib/email-renderer";
import { sendIncidentNotifications } from "./send-incident-notifications";
import { sendWebhookNotifications } from "./send-webhook-notifications";
import { sendSlackNotifications } from "./send-slack-notifications";

const mockSendEmail = jest.fn(async () => ({ success: true }));
const update = {
  id: "update",
  body: "Recovery in progress",
  status: "monitoring" as const,
  createdAt: new Date("2026-10-19T10:00:00Z"),
  deliverNotifications: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (db.query.incidents.findFirst as jest.Mock).mockResolvedValue({
    id: "incident",
    statusPageId: "page",
    name: "API",
    body: "Original failure",
    status: "investigating",
    impact: "major",
    createdAt: new Date("2026-10-18T10:00:00Z"),
    deliverNotifications: false,
  });
  (db.query.statusPages.findFirst as jest.Mock).mockResolvedValue({
    id: "page",
    name: "Status",
    status: "published",
    language: "en",
    allowEmailSubscribers: true,
    allowWebhookSubscribers: true,
    allowSlackSubscribers: true,
  });
  (db.query.incidentComponents.findMany as jest.Mock).mockResolvedValue([]);
  (resolveSubscribers as jest.Mock).mockResolvedValue([
    {
      id: "subscriber",
      email: "test@example.com",
      endpoint: "https://example.com/hook",
      webhookSecret: "secret",
      verifiedAt: new Date(),
      purgeAt: null,
      quarantinedAt: null,
    },
  ]);
  (deliverWebhook as jest.Mock).mockResolvedValue({ success: true });
  (deliverSlackMessage as jest.Mock).mockResolvedValue({ success: true });
});

it("sends the update body and timestamp even when creation notifications were off", async () => {
  await sendIncidentNotifications("incident", "page", update);
  expect(renderIncidentNotificationEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      incidentDescription: update.body,
      incidentStatus: "monitoring",
      updateTimestamp: expect.stringContaining("19"),
    }),
  );
  expect(mockSendEmail).toHaveBeenCalledTimes(1);
  await sendWebhookNotifications("incident", "page", update);
  await sendSlackNotifications("incident", "page", update);
  for (const deliver of [deliverWebhook, deliverSlackMessage]) {
    expect(deliver).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({
        type: "incident.updated",
        timestamp: update.createdAt.toISOString(),
        incident_update_id: "update",
        incident: expect.objectContaining({
          body: update.body,
          status: "monitoring",
        }),
      }),
      ...(deliver === deliverWebhook ? ["secret"] : []),
    );
  }
});

it("does not deliver an update whose notification flag is off", async () => {
  const silent = { ...update, deliverNotifications: false };
  await sendIncidentNotifications("incident", "page", silent);
  await sendWebhookNotifications("incident", "page", silent);
  await sendSlackNotifications("incident", "page", silent);
  expect(resolveSubscribers).not.toHaveBeenCalled();
});

it("counts a Slack failure toward quarantine only on the final attempt", async () => {
  (deliverSlackMessage as jest.Mock).mockResolvedValue({ success: false, error: "boom" });
  const sets: Array<Record<string, unknown>> = [];
  (db.update as jest.Mock).mockImplementation(() => ({
    set: (v: Record<string, unknown>) => (sets.push(v), { where: jest.fn() }),
  }));
  await sendSlackNotifications("incident", "page", update, "subscriber", false, false);
  expect(sets.every((s) => s.webhookFailures === undefined)).toBe(true);
  await sendSlackNotifications("incident", "page", update, "subscriber", false, true);
  expect(sets.some((s) => s.webhookFailures === 1)).toBe(true);
});
