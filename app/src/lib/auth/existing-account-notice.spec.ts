/** @jest-environment node */
const send = jest.fn();
const limit = jest.fn();
jest.mock("@/lib/email-service", () => ({ EmailService: { getInstance: () => ({ sendEmail: send }) } }));
jest.mock("@/lib/email-renderer", () => ({
  renderExistingAccountEmail: jest.fn(async (p: { signInUrl: string; resetUrl: string }) => ({ subject: "s", html: p.signInUrl, text: `${p.signInUrl} ${p.resetUrl}` })),
}));
jest.mock("@/lib/session-security", () => ({
  checkEmailVerificationRateLimit: (id: string) => limit(id),
  getClientIP: (h: Headers) => h.get("x-forwarded-for") ?? "unknown",
}));

import { sendExistingAccountNotice } from "./existing-account-notice";

const TOKEN = "01a149f7-ce26-70e2-997b-806e9f48d9de";
const req = (headers: Record<string, string> = {}) => new Request("http://internal/api/auth/sign-up/email", { method: "POST", headers });

describe("sendExistingAccountNotice", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    limit.mockResolvedValue({ allowed: true });
    send.mockResolvedValue({ success: true });
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test/";
  });

  it("emails a sign-in link that keeps a valid invite token, plus a reset link", async () => {
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-invite-token": TOKEN }));
    const mail = send.mock.calls[0][0];
    expect(mail.to).toBe("a@b.co");
    expect(mail.text).toContain(`https://app.example.test/sign-in?invite=${TOKEN} https://app.example.test/forgot-password`);
  });

  it("drops a malformed invite token instead of echoing it into the link", async () => {
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-invite-token": "../../evil" }));
    expect(send.mock.calls[0][0].text).toContain("https://app.example.test/sign-in https://");
  });

  it("sends nothing once the per-address or per-IP limit is hit", async () => {
    limit.mockResolvedValueOnce({ allowed: false });
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req());
    limit.mockResolvedValueOnce({ allowed: true }).mockResolvedValueOnce({ allowed: false });
    await sendExistingAccountNotice({ user: { email: "a@b.co" } }, req({ "x-forwarded-for": "1.2.3.4" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("never throws when delivery fails", async () => {
    send.mockRejectedValueOnce(new Error("smtp down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(sendExistingAccountNotice({ user: { email: "a@b.co" } }, req())).resolves.toBeUndefined();
  });
});
