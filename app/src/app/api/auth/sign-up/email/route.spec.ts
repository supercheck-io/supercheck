/** @jest-environment node */

import { NextRequest, NextResponse } from "next/server";

jest.mock("better-auth/next-js", () => {
  const handlers = {
    GET: jest.fn(),
    POST: jest.fn(),
  };

  return {
    toNextJsHandler: jest.fn(() => handlers),
    __handlers: handlers,
  };
});

jest.mock("@/utils/auth", () => ({
  auth: {},
}));

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

jest.mock("@/db/schema", () => ({
  invitation: {
    id: "id",
    expiresAt: "expiresAt",
    email: "email",
    status: "status",
  },
}));

jest.mock("@/lib/feature-flags", () => ({
  isSelfHosted: jest.fn(() => false),
  isSignupEnabled: jest.fn(() => true),
  isEmailDomainAllowed: jest.fn(() => true),
}));

import { POST } from "./route";

const { __handlers: mockBetterAuthHandlers } = jest.requireMock(
  "better-auth/next-js",
) as {
  __handlers: {
    GET: jest.Mock;
    POST: jest.Mock;
  };
};

const { db: mockDb } = jest.requireMock("@/utils/db") as {
  db: {
    select: jest.Mock;
  };
};

const { isSelfHosted: mockIsSelfHosted, isSignupEnabled: mockIsSignupEnabled, isEmailDomainAllowed: mockIsEmailDomainAllowed } = jest.requireMock(
  "@/lib/feature-flags",
) as {
  isSelfHosted: jest.Mock;
  isSignupEnabled: jest.Mock;
  isEmailDomainAllowed: jest.Mock;
};

describe("Email sign-up invite enforcement", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSelfHosted.mockReturnValue(false);
    mockIsSignupEnabled.mockReturnValue(true);
    mockIsEmailDomainAllowed.mockReturnValue(true);
    mockBetterAuthHandlers.POST.mockResolvedValue(
      NextResponse.json({ ok: true }, { status: 200 }),
    );
  });

  describe("cloud mode (invite-only)", () => {
    it("rejects sign-up when invite token is missing", async () => {
      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.code).toBe("INVITE_REQUIRED");
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
    });

    it("rejects sign-up when no matching pending invitation exists", async () => {
      const invitationQuery = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      };
      mockDb.select.mockReturnValue(invitationQuery);

      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-invite-token": "invite-token-1",
        },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.code).toBe("INVITE_REQUIRED");
      expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
    });

    it("rejects sign-up when invitation is expired", async () => {
      const invitationQuery = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: "invite-1",
                expiresAt: new Date(Date.now() - 60_000),
              },
            ]),
          }),
        }),
      };
      mockDb.select.mockReturnValue(invitationQuery);

      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-invite-token": "invite-token-1",
        },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.code).toBe("INVITE_EXPIRED");
      expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
    });

    it("allows sign-up when invitation exists and is not expired", async () => {
      const invitationQuery = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: "invite-1",
                expiresAt: new Date(Date.now() + 60_000),
              },
            ]),
          }),
        }),
      };
      mockDb.select.mockReturnValue(invitationQuery);

      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-invite-token": "invite-token-1",
        },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
    });

    it("allows sign-up when invitation email casing differs", async () => {
      const invitationQuery = {
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                id: "invite-1",
                email: "User@Example.com",
                expiresAt: new Date(Date.now() + 60_000),
              },
            ]),
          }),
        }),
      };
      mockDb.select.mockReturnValue(invitationQuery);

      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-invite-token": "invite-token-1",
        },
        body: JSON.stringify({ email: "user@example.com", password: "secret" }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
    });
  });

  describe("self-hosted mode (open registration)", () => {
    beforeEach(() => {
      mockIsSelfHosted.mockReturnValue(true);
    });

    it("allows sign-up without invite token", async () => {
      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          name: "Test User",
          password: "Secret123",
        }),
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
    });

    it("does not check invitation database", async () => {
      const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "another@example.com",
          name: "Another User",
          password: "Secret123",
        }),
      });

      await POST(request);

      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe("registration controls", () => {
    describe("SIGNUP_ENABLED=false", () => {
      beforeEach(() => {
        mockIsSignupEnabled.mockReturnValue(false);
      });

      it("rejects sign-up when signup is disabled and no invite token", async () => {
        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "user@example.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.code).toBe("SIGNUP_DISABLED");
        expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
      });

      it("allows sign-up when signup is disabled but invite token is present", async () => {
        const invitationQuery = {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: "invite-1",
                  expiresAt: new Date(Date.now() + 60_000),
                },
              ]),
            }),
          }),
        };
        mockDb.select.mockReturnValue(invitationQuery);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-invite-token": "invite-token-1",
          },
          body: JSON.stringify({
            email: "user@example.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
      });

      it("allows self-hosted sign-up when signup is disabled but invite token is present", async () => {
        mockIsSelfHosted.mockReturnValue(true);
        const invitationQuery = {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: "invite-1",
                  expiresAt: new Date(Date.now() + 60_000),
                },
              ]),
            }),
          }),
        };
        mockDb.select.mockReturnValue(invitationQuery);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-invite-token": "invite-token-1",
          },
          body: JSON.stringify({
            email: "user@example.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
      });

      it("rejects self-hosted sign-up when signup is disabled and invite token is invalid", async () => {
        mockIsSelfHosted.mockReturnValue(true);
        const invitationQuery = {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        };
        mockDb.select.mockReturnValue(invitationQuery);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-invite-token": "not-a-real-invite",
          },
          body: JSON.stringify({
            email: "user@example.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.code).toBe("INVITE_REQUIRED");
        expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
      });
    });

    describe("ALLOWED_EMAIL_DOMAINS restriction", () => {
      it("rejects sign-up when email domain is not allowed", async () => {
        mockIsEmailDomainAllowed.mockReturnValue(false);
        mockIsSelfHosted.mockReturnValue(true);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "user@evil.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
        expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
      });

      it("allows sign-up when email domain is allowed", async () => {
        mockIsEmailDomainAllowed.mockReturnValue(true);
        mockIsSelfHosted.mockReturnValue(true);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "user@acme.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);

        expect(response.status).toBe(200);
        expect(mockBetterAuthHandlers.POST).toHaveBeenCalledTimes(1);
      });

      it("domain check applies even to invited users in cloud mode", async () => {
        mockIsEmailDomainAllowed.mockReturnValue(false);

        const invitationQuery = {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  id: "invite-1",
                  expiresAt: new Date(Date.now() + 60_000),
                },
              ]),
            }),
          }),
        };
        mockDb.select.mockReturnValue(invitationQuery);

        const request = new NextRequest("http://localhost/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-invite-token": "invite-token-1",
          },
          body: JSON.stringify({
            email: "user@evil.com",
            name: "Test User",
            password: "Secret123",
          }),
        });

        const response = await POST(request);
        const body = await response.json();

        expect(response.status).toBe(403);
        expect(body.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
        expect(mockBetterAuthHandlers.POST).not.toHaveBeenCalled();
      });
    });
  });
});
