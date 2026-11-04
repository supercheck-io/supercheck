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
const statusPage = { id: "page-1", status: "published", name: "Acme", subdomain: "acme", language: "en", allowEmailSubscribers: true };

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      incidents: { findFirst: jest.fn(async () => incident) },
      statusPages: { findFirst: jest.fn(async () => statusPage) },
      incidentComponents: { findMany: jest.fn(async () => []) },
    },
  },
}));
jest.mock("./resolve-subscribers", () => ({ resolveSubscribers: jest.fn() }));
jest.mock("@/lib/email-renderer", () => ({
  renderIncidentNotificationEmail: jest.fn(async () => ({ subject: "s", text: "t", html: "h" })),
}));
const sendEmail = jest.fn(async () => ({ success: true }));
jest.mock("@/lib/email-service", () => ({
  EmailService: { getInstance: () => ({ sendEmail }) },
}));

import { renderIncidentNotificationEmail } from "@/lib/email-renderer";
import { resolveSubscribers } from "./resolve-subscribers";
import { sendIncidentNotifications } from "./send-incident-notifications";

const KEY = "test-secret-encryption-key-0123456789abcdef";
const ID = "11111111-1111-4111-8111-111111111111";
const base = { email: "a@example.test", verifiedAt: new Date(), quarantinedAt: null, purgeAt: null };
const original = process.env.SECRET_ENCRYPTION_KEY;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (original === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = original;
});

const urlSent = (call = 0) => jest.mocked(renderIncidentNotificationEmail).mock.calls[call][0].unsubscribeUrl;
const headersSent = (call = 0) =>
  (sendEmail.mock.calls[call] as unknown as [{ headers?: Record<string, string> }])[0].headers;

it("uses a signed link when the key is set", async () => {
  process.env.SECRET_ENCRYPTION_KEY = KEY;
  jest.mocked(resolveSubscribers).mockResolvedValue([{ ...base, id: ID }] as never);
  const result = await sendIncidentNotifications("incident-1", "page-1");
  expect(result.sentCount).toBe(1);
  expect(urlSent()).toMatch(new RegExp(`/status/unsubscribe/${ID}\\.[A-Za-z0-9_-]{43}$`));
  // Header carries the same signed token as the rendered link, on the API route.
  expect(headersSent()?.["List-Unsubscribe"]).toBe(
    `<${String(urlSent()).replace("/status/unsubscribe/", "/api/status-pages/unsubscribe/")}>`,
  );
  expect(console.warn).not.toHaveBeenCalled();
});

describe("without SECRET_ENCRYPTION_KEY", () => {
  beforeEach(() => {
    delete process.env.SECRET_ENCRYPTION_KEY;
  });

  it("sends without a link or headers and warns once per batch", async () => {
    jest.mocked(resolveSubscribers).mockResolvedValue([
      { ...base, id: ID },
      { ...base, id: "22222222-2222-4222-8222-222222222222", email: "b@example.test" },
    ] as never);
    const result = await sendIncidentNotifications("incident-1", "page-1");
    expect(result).toMatchObject({ success: true, sentCount: 2 });
    expect(urlSent(0)).toBeUndefined();
    expect(headersSent(1)).toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
