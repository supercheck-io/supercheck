/** @jest-environment node */

var routeHandlers:
  | {
      GET: jest.Mock;
      POST: jest.Mock;
    }
  | undefined;

var receivedAuth: { __config?: { plugins?: unknown[] } } | undefined;

jest.mock("better-auth", () => ({
  betterAuth: jest.fn((config) => ({ __config: config })),
}));

jest.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: jest.fn(() => ({ type: "drizzle-adapter" })),
}));

jest.mock("better-auth/plugins", () => ({
  organization: jest.fn((options) => ({ type: "organization", options })),
  admin: jest.fn((options) => ({ type: "admin", options })),
  lastLoginMethod: jest.fn(() => ({ type: "last-login-method" })),
  captcha: jest.fn((options) => ({ type: "captcha", options })),
}));

jest.mock("@better-auth/api-key", () => ({
  apiKey: jest.fn(() => ({ type: "api-key" })),
}));

jest.mock("better-auth/next-js", () => ({
  nextCookies: jest.fn(() => ({ type: "next-cookies" })),
  toNextJsHandler: jest.fn((auth) => {
    receivedAuth = auth;
    if (!routeHandlers) {
      routeHandlers = {
        GET: jest.fn(),
        POST: jest.fn(),
      };
    }
    return routeHandlers;
  }),
}));

jest.mock("@polar-sh/better-auth", () => ({
  polar: jest.fn((options) => ({ type: "polar", options })),
  checkout: jest.fn((options) => ({ type: "checkout", options })),
  portal: jest.fn((options) => ({ type: "portal", options })),
  usage: jest.fn(() => ({ type: "usage" })),
  webhooks: jest.fn((options) => ({ type: "webhooks", options })),
}));

jest.mock("@polar-sh/sdk", () => ({
  Polar: jest.fn().mockImplementation(() => ({
    customers: {},
  })),
}));

jest.mock("@/utils/db", () => ({
  db: {},
}));

jest.mock("@/db/schema", () => ({
  authSchema: {},
}));

jest.mock("@/lib/rbac/permissions", () => ({
  ac: {},
  roles: {
    ORG_ADMIN: {},
    SUPER_ADMIN: {},
    ORG_OWNER: {},
    PROJECT_ADMIN: {},
    PROJECT_EDITOR: {},
    PROJECT_VIEWER: {},
  },
  Role: {
    ORG_ADMIN: "ORG_ADMIN",
    SUPER_ADMIN: "SUPER_ADMIN",
    ORG_OWNER: "ORG_OWNER",
    PROJECT_ADMIN: "PROJECT_ADMIN",
    PROJECT_EDITOR: "PROJECT_EDITOR",
    PROJECT_VIEWER: "PROJECT_VIEWER",
  },
}));

jest.mock("@/lib/email-service", () => ({
  EmailService: {
    getInstance: jest.fn(() => ({
      sendEmail: jest.fn().mockResolvedValue({ success: true, message: "ok" }),
    })),
  },
}));

jest.mock("@/lib/session-security", () => ({
  checkPasswordResetRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  checkEmailVerificationRateLimit: jest.fn().mockResolvedValue({ allowed: true }),
  getClientIP: jest.fn(() => "127.0.0.1"),
}));

jest.mock("@/lib/email-renderer", () => ({
  renderPasswordResetEmail: jest.fn().mockResolvedValue({
    subject: "Reset",
    text: "Reset",
    html: "<p>Reset</p>",
  }),
  renderEmailVerificationEmail: jest.fn().mockResolvedValue({
    subject: "Verify",
    text: "Verify",
    html: "<p>Verify</p>",
  }),
}));

jest.mock("@/lib/feature-flags", () => ({
  isPolarEnabled: jest.fn(() => true),
  getPolarConfig: jest.fn(() => ({
    accessToken: "polar-token",
    server: "sandbox",
    webhookSecret: "polar-secret",
  })),
  getPolarProducts: jest.fn(() => ({
    plusProductId: "prod-plus",
    proProductId: "prod-pro",
  })),
  isCloudHosted: jest.fn(() => false),
  isCaptchaEnabled: jest.fn(() => false),
}));

jest.mock("@/lib/webhooks/polar-webhooks", () => ({
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
}));

import { GET, POST } from "./route";

const polarWebhookHandlers = jest.requireMock("@/lib/webhooks/polar-webhooks") as {
  handleSubscriptionActive: jest.Mock;
  handleSubscriptionCreated: jest.Mock;
};

function getWebhookOptions() {
  const plugins = receivedAuth?.__config?.plugins ?? [];
  const polarPlugin = plugins.find(
    (plugin): plugin is { type: string; options: { use?: unknown[] } } =>
      typeof plugin === "object" && plugin !== null && (plugin as { type?: string }).type === "polar"
  );

  if (!polarPlugin) {
    throw new Error("Polar plugin not found in Better Auth configuration");
  }

  const webhookPlugin = polarPlugin.options.use?.find(
    (plugin): plugin is { type: string; options: Record<string, unknown> } =>
      typeof plugin === "object" && plugin !== null && (plugin as { type?: string }).type === "webhooks"
  );

  if (!webhookPlugin) {
    throw new Error("Polar webhooks plugin not found in Better Auth configuration");
  }

  return webhookPlugin.options as {
    onSubscriptionCreated?: (payload: unknown) => Promise<void>;
    onSubscriptionActive?: (payload: unknown) => Promise<void>;
  };
}

describe("Better Auth Polar webhook route wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exports the Better Auth route handlers", () => {
    const handlers = routeHandlers;
    expect(handlers).toBeDefined();
    expect(GET).toBe(handlers!.GET);
    expect(POST).toBe(handlers!.POST);
  });

  it("routes subscription.created through the non-activating handler", async () => {
    const payload = {
      id: "evt-created",
      type: "subscription.created",
      data: {
        id: "sub-123",
        status: "incomplete",
      },
    };

    await getWebhookOptions().onSubscriptionCreated?.(payload);

    expect(polarWebhookHandlers.handleSubscriptionCreated).toHaveBeenCalledWith(payload);
    expect(polarWebhookHandlers.handleSubscriptionActive).not.toHaveBeenCalled();
  });

  it("keeps subscription.active routed to the activation handler", async () => {
    const payload = {
      id: "evt-active",
      type: "subscription.active",
      data: {
        id: "sub-123",
        status: "active",
      },
    };

    await getWebhookOptions().onSubscriptionActive?.(payload);

    expect(polarWebhookHandlers.handleSubscriptionActive).toHaveBeenCalledWith(payload);
  });
});
