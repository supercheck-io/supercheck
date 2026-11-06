import nodemailer from "nodemailer";
import { EmailService, smtpSender } from "./email-service";

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn(),
  },
}));

describe("EmailService", () => {
  const mockedCreateTransport = nodemailer.createTransport as jest.Mock;
  const service = EmailService.getInstance();

  beforeEach(() => {
    jest.clearAllMocks();
    // The singleton caches its pooled transporter; start each test fresh.
    (service as unknown as { transporter?: unknown }).transporter = undefined;
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user@example.com";
    process.env.SMTP_PASSWORD = "password";
    process.env.SMTP_FROM_EMAIL = "alerts@example.com";
    process.env.SMTP_SECURE = "false";
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM_EMAIL;
    delete process.env.SMTP_SECURE;
  });

  it("sends a single email successfully", async () => {
    const mockVerify = jest.fn().mockResolvedValue(true);
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-123" });

    mockedCreateTransport.mockReturnValue({
      verify: mockVerify,
      sendMail: mockSendMail,
    });

    const result = await service.sendEmail({
      to: "user@test.com",
      subject: "Test",
      text: "Plain text",
      html: "<p>Plain text</p>",
    });

    expect(result).toEqual({
      success: true,
      message: "Email sent successfully via SMTP",
    });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "alerts@example.com",
        to: "user@test.com",
        subject: "Test",
      }),
    );
  });

  it("sends to all recipients sequentially and records partial failures", async () => {
    const mockSendMail = jest
      .fn()
      .mockResolvedValueOnce({ messageId: "msg-1" })
      .mockRejectedValueOnce(new Error("Recipient rejected"))
      .mockResolvedValueOnce({ messageId: "msg-3" });

    mockedCreateTransport.mockReturnValue({
      verify: jest.fn().mockResolvedValue(true),
      sendMail: mockSendMail,
    });

    const result = await service.sendEmailToMultiple({
      recipients: ["first@test.com", "bad@test.com", "third@test.com"],
      subject: "Alert",
      text: "Alert body",
      html: "<p>Alert body</p>",
    });

    expect(result).toEqual({
      sentCount: 2,
      failedAddresses: ["bad@test.com"],
      errors: {
        "bad@test.com": "Recipient rejected",
      },
      skippedAddresses: [],
    });
    expect(mockSendMail).toHaveBeenCalledTimes(3);
    expect(mockSendMail).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ to: "first@test.com" }),
    );
    expect(mockSendMail).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ to: "bad@test.com" }),
    );
    expect(mockSendMail).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ to: "third@test.com" }),
    );
  });

  it("never hands undeliverable recipients to SMTP", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-1" });
    mockedCreateTransport.mockReturnValue({
      verify: jest.fn().mockResolvedValue(true),
      sendMail: mockSendMail,
    });

    const single = await service.sendEmail({
      to: "nobody@example.invalid",
      subject: "Hi",
      text: "Hi",
      html: "<p>Hi</p>",
    });
    expect(single).toEqual(expect.objectContaining({ success: true }));

    const multi = await service.sendEmailToMultiple({
      recipients: ["a@example.com", "ok@test.com"],
      subject: "Alert",
      text: "Alert body",
      html: "<p>Alert body</p>",
    });
    expect(multi.sentCount).toBe(1);
    expect(multi.failedAddresses).toEqual([]);
    expect(multi.skippedAddresses).toEqual(["a@example.com"]);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ok@test.com" }));
  });

  it("does not verify() per send and reuses the pooled transporter", async () => {
    const mockVerify = jest.fn();
    mockedCreateTransport.mockReturnValue({ verify: mockVerify, sendMail: jest.fn().mockResolvedValue({}) });
    const message = { recipients: ["a@test.com"], subject: "S", text: "t", html: "<p>t</p>" };

    await service.sendEmailToMultiple(message);
    await service.sendEmailToMultiple(message);

    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockedCreateTransport).toHaveBeenCalledTimes(1);
    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ pool: true, connectionTimeout: 10000, greetingTimeout: 5000 }),
    );
  });

  it("rebuilds the transporter when the SMTP config changes", async () => {
    const close = jest.fn();
    mockedCreateTransport.mockReturnValue({ close, sendMail: jest.fn().mockResolvedValue({}) });
    const message = { recipients: ["a@test.com"], subject: "S", text: "t", html: "<p>t</p>" };

    await service.sendEmailToMultiple(message);
    process.env.SMTP_HOST = "smtp2.example.com";
    await service.sendEmailToMultiple(message);

    expect(mockedCreateTransport).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails the remaining recipients fast after a connection-level error", async () => {
    const mockSendMail = jest
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" }));
    mockedCreateTransport.mockReturnValue({ sendMail: mockSendMail });

    const result = await service.sendEmailToMultiple({
      recipients: ["first@test.com", "second@test.com"],
      subject: "Alert",
      text: "Alert body",
      html: "<p>Alert body</p>",
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      sentCount: 0,
      failedAddresses: ["first@test.com", "second@test.com"],
      errors: {
        "first@test.com": "Connection timeout",
        "second@test.com": "Connection timeout",
      },
      skippedAddresses: [],
    });
  });
});

describe("smtpSender", () => {
  const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

  it("is the bare address with no Reply-To by default", () => {
    expect(smtpSender(env({ SMTP_FROM_EMAIL: "a@x.io" }))).toEqual({ from: "a@x.io" });
  });

  it("adds a display name and Reply-To only when configured", () => {
    expect(
      smtpSender(env({ SMTP_FROM_EMAIL: "a@x.io", SMTP_FROM_NAME: " Acme ", SMTP_REPLY_TO: "s@x.io" })),
    ).toEqual({ from: { name: "Acme", address: "a@x.io" }, replyTo: "s@x.io" });
  });

  it("keeps a From that already has a display name", () => {
    expect(
      smtpSender(env({ SMTP_FROM_EMAIL: "Acme <a@x.io>", SMTP_FROM_NAME: "Other" })).from,
    ).toBe("Acme <a@x.io>");
  });
});
