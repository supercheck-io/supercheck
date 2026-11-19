/** @jest-environment node */
const send = jest.fn();
const limit = jest.fn();
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmail: send }) } }));
jest.mock("@/lib/email-renderer", () => ({
  renderExistingAccountEmail: jest.fn(async (p: { signInUrl: string; resetUrl: string }) => ({ subject: "s", html: p.signInUrl, text: `${p.signInUrl} ${p.resetUrl}` })),
}));
const noticeLimit = jest.fn();
const invite = jest.fn();
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => invite() }) }) }) } }));
jest.mock("@/db/schema", () => ({ invitation: { id: "id", email: "email", status: "status", expiresAt: "expiresAt" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn() }));
jest.mock("@/lib/session-security", () => ({
  checkEmailVerificationRateLimit: (id: string) => limit(id),
  checkExistingAccountNoticeRateLimit: (id: string) => noticeLimit(id),
  getClientIP: (h: Headers) => h.get("x-forwarded-for") ?? "unknown",
}));

import { sendExistingAccountNotice } from "./existing-account-notice";

const TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
const req = (headers: Record<string, string> = {}) => new Request("http://internal/api/auth/sign-up/email", { method: "POST", headers });

describe("sendExistingAccountNotice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limit.mockResolvedValue({ allowed: true });
    noticeLimit.mockResolvedValue({ allowed: true });
    invite.mockResolvedValue([{ email: "a@b.co", status: "pending", expiresAt: new Date(Date.now() + 1e6) }]);
    send.mockResolvedValue({ success: true });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test/";
  });

  it("emails a sign-in link that keeps a valid invite token, plus a reset link", async () => {
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-invite-token": TOKEN }));
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("a@b.co");
    expect(mail.text).toContain(`https://app.example.test/sign-in?invite=${TOKEN} https://app.example.test/forgot-password`);
  });

  it.each([
    ["is for another address", [{ email: "x@y.co", status: "pending", expiresAt: new Date(Date.now() + 1e6) }]],
    ["is used", [{ email: "a@b.co", status: "accepted", expiresAt: new Date(Date.now() + 1e6) }]],
    ["is expired", [{ email: "a@b.co", status: "pending", expiresAt: new Date(Date.now() - 1e3) }]],
    ["does not exist", []],
  ])("does not echo an invite token whose invitation %s", async (_name, rows) => {
    invite.mockResolvedValue(rows);
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-invite-token": TOKEN }));
    expect(send.mock.calls[0][0].text).toContain("https://app.example.test/sign-in https://");
  });

  it("uses its own per-address counter, not the verification-email one", async () => {
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req());
    expect(noticeLimit).toHaveBeenCalledWith("a@b.co");
    expect(limit).not.toHaveBeenCalledWith("a@b.co");
  });

  it("drops a malformed invite token instead of echoing it into the link", async () => {
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-invite-token": "../../evil" }));
    expect(send.mock.calls[0][0].text).toContain("https://app.example.test/sign-in https://");
  });

  it("sends nothing once the per-address or per-IP limit is hit", async () => {
    noticeLimit.mockResolvedValueOnce({ allowed: false });
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req());
    limit.mockResolvedValueOnce({ allowed: false });
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-forwarded-for": "1.2.3.4" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing when no app URL is configured, rather than trusting the request Host", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.BETTER_AUTH_URL;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req());
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws when delivery fails", async () => {
    send.mockRejectedValueOnce(new Error("smtp down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendExistingAccountNotice({ user: { email: "a@b.co" } }, req())).resolves.toBeUndefined();
  });
});
