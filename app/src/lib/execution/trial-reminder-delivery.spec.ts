/** @jest-environment node */
const mockSend = jest.fn();
const mockRender = jest.fn();
jest.mock("@/lib/email-service", () => ({
  EmailService: {
    getInstance: () => ({
      sendEmailToMultiple: (...args: unknown[]) => mockSend(...args),
    }),
  },
}));
jest.mock("@/lib/email-renderer", () => ({
  renderTrialNotificationEmail: (...args: unknown[]) => mockRender(...args),
}));
import {
  deliverTrialReminder,
  trialSubscribeUrl,
} from "./trial-reminder-delivery";

const delivery = {
  kind: "midway" as const,
  organizationId: "org",
  organizationName: "Acme",
  daysRemaining: 7,
  recipients: ["owner@example.com"],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRender.mockResolvedValue({
    subject: "Subject",
    html: "<p>html</p>",
    text: "text",
  });
});

describe("trialSubscribeUrl", () => {
  it("links to the subscribe page on the app URL without a double slash", () => {
    expect(
      trialSubscribeUrl({
        NEXT_PUBLIC_APP_URL: "https://app.supercheck.io/",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("https://app.supercheck.io/subscribe");
  });

  it("falls back to the auth URL", () => {
    expect(
      trialSubscribeUrl({
        BETTER_AUTH_URL: "https://auth.example.com",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("https://auth.example.com/subscribe");
  });
});

describe("deliverTrialReminder", () => {
  it("renders the reminder and sends it to the owners", async () => {
    mockSend.mockResolvedValue({
      sentCount: 1,
      failedAddresses: [],
      errors: {},
    });
    await expect(deliverTrialReminder(delivery)).resolves.toBe(true);
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: "Acme",
        kind: "midway",
        daysRemaining: 7,
      }),
    );
    expect(mockSend).toHaveBeenCalledWith({
      recipients: ["owner@example.com"],
      subject: "Subject",
      text: "text",
      html: "<p>html</p>",
    });
  });

  it("reports failure when nothing was delivered, so the reminder is retried", async () => {
    mockSend.mockResolvedValue({
      sentCount: 0,
      failedAddresses: ["owner@example.com"],
      errors: {},
    });
    await expect(deliverTrialReminder(delivery)).resolves.toBe(false);
  });
});
