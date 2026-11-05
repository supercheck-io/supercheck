import nodemailer from "nodemailer";
import { EmailService } from "./email-service";

jest.mock("node:dns/promises", () => ({
  Resolver: jest.fn().mockImplementation(() => ({
    resolveMx: async () => [{ exchange: "mx.test.com", priority: 10 }],
  })),
}));

const mockFindSuppressed = jest.fn(async (_emails: string[]) => new Set<string>());
jest.mock("@/lib/email-suppression", () => ({
  findSuppressedEmails: (emails: string[]) => mockFindSuppressed(emails),
}));

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

  it("skips addresses on the bounce suppression list", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "m" });
    mockedCreateTransport.mockReturnValue({ verify: jest.fn().mockResolvedValue(true), sendMail: mockSendMail });
    mockFindSuppressed.mockResolvedValueOnce(new Set(["gone@test.com"]));

    const result = await service.sendEmailToMultiple({
      recipients: ["Gone@test.com", "ok@test.com"],
      subject: "Alert",
      text: "Alert body",
      html: "<p>Alert body</p>",
    });
    expect(result.skippedAddresses).toEqual(["Gone@test.com"]);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "ok@test.com" }));
  });

  it("sends account mail even to a suppressed address", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "m" });
    mockedCreateTransport.mockReturnValue({ verify: jest.fn().mockResolvedValue(true), sendMail: mockSendMail });
    mockFindSuppressed.mockResolvedValue(new Set(["gone@test.com"]));
    await service.sendEmail({ to: "gone@test.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(mockSendMail).not.toHaveBeenCalled();
    await service.sendEmail({ to: "gone@test.com", subject: "s", text: "t", html: "<p>t</p>", bypassSuppression: true });
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    mockFindSuppressed.mockResolvedValue(new Set());
  });

  it("still sends when the suppression lookup fails", async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: "m" });
    mockedCreateTransport.mockReturnValue({ verify: jest.fn().mockResolvedValue(true), sendMail: mockSendMail });
    mockFindSuppressed.mockRejectedValueOnce(new Error("db down"));
    const result = await service.sendEmail({ to: "ok@test.com", subject: "s", text: "t", html: "<p>t</p>" });
    expect(result.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("returns all recipients as failed when SMTP verification fails", async () => {
    mockedCreateTransport.mockReturnValue({
      verify: jest.fn().mockRejectedValue(new Error("Connection failed")),
      sendMail: jest.fn(),
    });

    const result = await service.sendEmailToMultiple({
      recipients: ["first@test.com", "second@test.com"],
      subject: "Alert",
      text: "Alert body",
      html: "<p>Alert body</p>",
    });

    expect(result).toEqual({
      sentCount: 0,
      failedAddresses: ["first@test.com", "second@test.com"],
      errors: {
        "first@test.com": "Connection failed",
        "second@test.com": "Connection failed",
      },
      skippedAddresses: [],
    });
  });
});
