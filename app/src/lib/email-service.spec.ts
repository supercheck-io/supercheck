import nodemailer from "nodemailer";
import { EmailService } from "./email-service";

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
    });
  });
});
