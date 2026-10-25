/** @jest-environment node */
// Proves src/utils/auth.ts wires every Polar webhook callback through the payload
// normaliser, so handlers keep receiving the shape they read on the 2026-10 API.
const mockPolarFactory = jest.fn((options: unknown) => ({
  id: "polar",
  options,
}));
const mockWebhooksFactory = jest.fn((options: unknown) => options);
const mockCreateCoreClient = jest.fn(() => ({ core: true }));
const handlers = {
  handleCustomerCreated: jest.fn(),
  handleSubscriptionActive: jest.fn(),
  handleSubscriptionCreated: jest.fn(),
  handleSubscriptionUpdated: jest.fn(),
  handleSubscriptionCanceled: jest.fn(),
  handleSubscriptionUncanceled: jest.fn(),
  handleSubscriptionRevoked: jest.fn(),
  handleOrderCreated: jest.fn(),
  handleOrderPaid: jest.fn(),
  handleCustomerStateChanged: jest.fn(),
  handleCustomerDeleted: jest.fn(),
  handleSubscriptionPastDue: jest.fn(),
};
let captured: Record<string, (payload: unknown) => Promise<void>> = {};
let polarClientOptions: unknown;
let pluginOptions: unknown;

jest.mock("@polar-sh/better-auth", () => ({
  polar: (options: unknown) => mockPolarFactory(options),
  webhooks: (options: unknown) => mockWebhooksFactory(options),
}));
jest.mock("@/lib/billing/polar-client", () => ({
  createPolarCoreClient: (options: unknown) => {
    polarClientOptions = options;
    return mockCreateCoreClient();
  },
}));
jest.mock("@/lib/webhooks/polar-webhooks", () => handlers);
jest.mock("better-auth", () => ({
  betterAuth: jest.fn((config: unknown) => config),
}));
jest.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: jest.fn(() => ({})),
}));
jest.mock("better-auth/next-js", () => ({ nextCookies: jest.fn(() => ({})) }));
jest.mock("better-auth/plugins", () => ({
  organization: jest.fn(() => ({})),
  admin: jest.fn(() => ({})),
  lastLoginMethod: jest.fn(() => ({})),
  captcha: jest.fn(() => ({})),
  jwt: jest.fn(() => ({})),
}));
jest.mock("@better-auth/api-key", () => ({ apiKey: jest.fn(() => ({})) }));
jest.mock("@/utils/db", () => ({ db: {} }));
jest.mock("@/lib/security/login-lockout-hooks", () => ({
  loginLockoutHooks: {},
}));
jest.mock("@/lib/rbac/permissions", () => ({
  ac: {},
  roles: new Proxy({}, { get: () => ({}) }),
  Role: new Proxy({}, { get: (_t, key) => String(key) }),
}));
jest.mock("@/lib/email-service", () => ({
  EmailService: { getInstance: jest.fn(() => ({})) },
}));
jest.mock("@/lib/session-security", () => ({
  checkPasswordResetRateLimit: jest.fn(),
  checkEmailVerificationRateLimit: jest.fn(),
  getClientIP: jest.fn(),
}));
jest.mock("@/lib/email-renderer", () => ({
  renderPasswordResetEmail: jest.fn(),
  renderEmailVerificationEmail: jest.fn(),
}));

const snake = {
  type: "x",
  data: {
    customer_id: "cus_1",
    current_period_end: "2026-11-01T00:00:00Z",
    metadata: { reference_id: "kept", referenceId: "org" },
  },
};

describe("auth.ts Polar wiring", () => {
  beforeAll(async () => {
    process.env.SELF_HOSTED = "false";
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_test";
    process.env.POLAR_WEBHOOK_SECRET = "whsec";
    process.env.POLAR_SERVER = "sandbox";
    process.env.BETTER_AUTH_SECRET = "s".repeat(40);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    await import("./auth");
    captured = mockWebhooksFactory.mock.calls[0][0] as typeof captured;
    pluginOptions = mockPolarFactory.mock.calls[0][0];
  });
  beforeEach(() => jest.clearAllMocks());

  it("builds the core client for the configured server and passes it to the plugin", () => {
    expect(polarClientOptions).toEqual({
      accessToken: "polar_oat_test",
      server: "sandbox",
    });
    expect(pluginOptions).toEqual(
      expect.objectContaining({
        client: { core: true },
        createCustomerOnSignUp: false,
      }),
    );
  });

  it("verifies webhooks with the configured secret only", () => {
    expect((captured as unknown as { secret: string }).secret).toBe("whsec");
  });

  it.each([
    ["onCustomerCreated", "handleCustomerCreated"],
    ["onSubscriptionActive", "handleSubscriptionActive"],
    ["onSubscriptionCreated", "handleSubscriptionCreated"],
    ["onSubscriptionUpdated", "handleSubscriptionUpdated"],
    ["onSubscriptionCanceled", "handleSubscriptionCanceled"],
    ["onSubscriptionUncanceled", "handleSubscriptionUncanceled"],
    ["onSubscriptionRevoked", "handleSubscriptionRevoked"],
    ["onOrderCreated", "handleOrderCreated"],
    ["onOrderPaid", "handleOrderPaid"],
    ["onCustomerDeleted", "handleCustomerDeleted"],
  ] as const)("%s hands %s a normalised payload", async (callback, handler) => {
    await captured[callback](snake);
    const received = handlers[handler].mock.calls[0][0];
    expect(received.data.customerId).toBe("cus_1");
    expect(received.data.currentPeriodEnd).toBe("2026-11-01T00:00:00Z");
    expect(received.data.customer_id).toBe("cus_1");
    expect(received.data.metadata).toEqual({
      reference_id: "kept",
      referenceId: "org",
    });
  });

  it("routes past-due through the catch-all with a normalised payload and ignores other event types", async () => {
    await captured.onPayload({
      type: "subscription.past_due",
      data: snake.data,
    });
    expect(
      handlers.handleSubscriptionPastDue.mock.calls[0][0].data.customerId,
    ).toBe("cus_1");
    await captured.onPayload({ type: "something.else", data: snake.data });
    expect(handlers.handleSubscriptionPastDue).toHaveBeenCalledTimes(1);
  });

  it("normalises the customer-state payload for authoritative reconciliation", async () => {
    await captured.onCustomerStateChanged(snake);
    expect(handlers.handleCustomerStateChanged).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ customerId: "cus_1" }) }));
  });

  it("registers no unexpected webhook callbacks", () => {
    const names = Object.keys(captured)
      .filter((key) => key.startsWith("on"))
      .sort();
    expect(names).toEqual(
      [
        "onCustomerCreated",
        "onCustomerDeleted",
        "onCustomerStateChanged",
        "onOrderCreated",
        "onOrderPaid",
        "onSubscriptionActive",
        "onSubscriptionCanceled",
        "onSubscriptionCreated",
        "onPayload",
        "onSubscriptionRevoked",
        "onSubscriptionUncanceled",
        "onSubscriptionUpdated",
      ].sort(),
    );
  });
});
