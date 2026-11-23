/** @jest-environment node */
const subscriber: Record<string, unknown> = {};
const page: Record<string, unknown> = {};
jest.mock("@/utils/db", () => ({
  db: {
    query: {
      statusPageSubscribers: { findFirst: jest.fn(async () => subscriber) },
      statusPages: { findFirst: jest.fn(async () => page) },
    },
  },
}));
const renderStatusPageWelcomeEmail = jest.fn(async () => ({ subject: "s", text: "t", html: "h" }));
jest.mock("@/lib/email-renderer", () => ({
  renderStatusPageWelcomeEmail: (...args: unknown[]) => renderStatusPageWelcomeEmail(...(args as [])),
}));
const sendEmail = jest.fn(async () => ({ success: true }));
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmail }) } }));

import { sendSubscriberWelcome } from "./send-subscriber-welcome";

const ID = "11111111-1111-4111-8111-111111111111";
const original = { key: process.env.SECRET_ENCRYPTION_KEY, url: process.env.NEXT_PUBLIC_APP_URL };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => {});
  process.env.SECRET_ENCRYPTION_KEY = "test-secret-encryption-key-0123456789abcdef";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  Object.assign(subscriber, { id: ID, email: "a@example.test", mode: "email", statusPageId: "page-1", verifiedAt: new Date(), purgeAt: null, quarantinedAt: null });
  Object.assign(page, { id: "page-1", name: "Acme Status", subdomain: "acme", status: "published", allowEmailSubscribers: true, language: "de" });
});
afterAll(() => {
  if (original.key === undefined) delete process.env.SECRET_ENCRYPTION_KEY;
  else process.env.SECRET_ENCRYPTION_KEY = original.key;
  if (original.url === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = original.url;
});

it("sends the welcome email in the page's language with a signed unsubscribe link and one-click header", async () => {
  expect(await sendSubscriberWelcome(ID)).toBe(true);
  const params = renderStatusPageWelcomeEmail.mock.calls[0][0 as never] as { unsubscribeUrl: string; statusPageName: string; language: string; statusPageUrl: string };
  expect(params).toMatchObject({ statusPageName: "Acme Status", language: "de" });
  expect(params.statusPageUrl).toMatch(/^https?:\/\//);
  expect(params.unsubscribeUrl).toMatch(new RegExp(`^https://app.example.com/status/unsubscribe/${ID}\\.`));
  const sent = (sendEmail.mock.calls[0] as unknown as [{ to: string; headers: Record<string, string> }])[0];
  expect(sent.to).toBe("a@example.test");
  expect(sent.headers["List-Unsubscribe"]).toBe(`<${params.unsubscribeUrl.replace("/status/unsubscribe/", "/api/status-pages/unsubscribe/")}>`);
  expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
});

it("sends nothing and logs an error without SECRET_ENCRYPTION_KEY (no working unsubscribe link)", async () => {
  delete process.env.SECRET_ENCRYPTION_KEY;
  expect(await sendSubscriberWelcome(ID)).toBe(false);
  expect(sendEmail).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining("SECRET_ENCRYPTION_KEY"));
});

it.each([
  ["an unverified subscriber", () => Object.assign(subscriber, { verifiedAt: null })],
  ["an unsubscribed subscriber", () => Object.assign(subscriber, { purgeAt: new Date() })],
  ["a webhook subscriber", () => Object.assign(subscriber, { mode: "webhook" })],
  ["an unpublished page", () => Object.assign(page, { status: "draft" })],
  ["a page with email subscriptions off", () => Object.assign(page, { allowEmailSubscribers: false })],
])("sends nothing for %s", async (_label, arrange) => {
  arrange();
  expect(await sendSubscriberWelcome(ID)).toBe(false);
  expect(sendEmail).not.toHaveBeenCalled();
});

it("never throws when sending fails", async () => {
  sendEmail.mockRejectedValueOnce(new Error("smtp down"));
  await expect(sendSubscriberWelcome(ID)).resolves.toBe(false);
});
