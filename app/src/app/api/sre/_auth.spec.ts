/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
  isAuthError: jest.fn((error: unknown) => error instanceof Error && error.message === "Authentication required"),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

import { requireAuthContext } from "@/lib/auth-context";
import { checkPermissionWithContext } from "@/lib/rbac/middleware";
import { requireSreApiPermissions, requireSreSameOriginRequest } from "./_auth";

const mockRequireProjectContext = requireAuthContext as jest.Mock;
const mockCheckPermissionWithContext = checkPermissionWithContext as jest.Mock;

const context = {
  userId: "018f0000-0000-7000-8000-000000000001",
  organizationId: "018f0000-0000-7000-8000-000000000002",
  project: {
    id: "018f0000-0000-7000-8000-000000000003",
    name: "Prod",
    userRole: "project_admin",
  },
};

function postRequest(origin?: string | null, referer?: string | null) {
  const headers = new Headers();
  if (origin) {
    headers.set("origin", origin);
  }
  if (referer) {
    headers.set("referer", referer);
  }

  return new NextRequest("https://app.supercheck.example/api/sre/chat", {
    method: "POST",
    headers,
  });
}

describe("requireSreApiPermissions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue(context);
    mockCheckPermissionWithContext.mockReturnValue(true);
  });

  it("returns 401 when project auth is missing", async () => {
    mockRequireProjectContext.mockRejectedValue(new Error("Authentication required"));

    const result = await requireSreApiPermissions([{ resource: "sre_connector", action: "view" }]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(401);
    }
    expect(mockCheckPermissionWithContext).not.toHaveBeenCalled();
  });

  it("returns 403 when any required permission is denied", async () => {
    mockCheckPermissionWithContext.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const result = await requireSreApiPermissions([
      { resource: "sre_connector", action: "view" },
      { resource: "notification", action: "view" },
    ]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.response.status).toBe(403);
    }
  });

  it("returns the existing project context when all permissions pass", async () => {
    const result = await requireSreApiPermissions([{ resource: "sre_service", action: "view" }]);

    expect(result).toEqual({ success: true, context });
    expect(mockCheckPermissionWithContext).toHaveBeenCalledWith(
      "sre_service",
      "view",
      {
        userId: context.userId,
        organizationId: context.organizationId,
        project: context.project,
      },
    );
  });

  it("preserves project-scoped CLI bearer authentication", async () => {
    const cliContext = { ...context, isCliAuth: true };
    mockRequireProjectContext.mockResolvedValue(cliContext);

    const result = await requireSreApiPermissions([
      { resource: "sre_incident", action: "view" },
    ]);

    expect(result).toEqual({ success: true, context: cliContext });
    expect(mockCheckPermissionWithContext).toHaveBeenCalledWith(
      "sre_incident",
      "view",
      expect.objectContaining({
        userId: context.userId,
        organizationId: context.organizationId,
        project: context.project,
      }),
    );
  });
});

describe("requireSreSameOriginRequest", () => {
  const originalAppUrl = process.env.APP_URL;
  const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

  afterEach(() => {
    if (originalAppUrl === undefined) {
      delete process.env.APP_URL;
    } else {
      process.env.APP_URL = originalAppUrl;
    }
    if (originalNextPublicAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
    }
    if (originalBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    }
  });

  it("allows same-origin SRE requests", () => {
    const response = requireSreSameOriginRequest(postRequest("https://app.supercheck.example"));

    expect(response).toBeNull();
  });

  it("allows configured production app origins", () => {
    process.env.APP_URL = "https://supercheck.example";

    const response = requireSreSameOriginRequest(postRequest("https://supercheck.example"));

    expect(response).toBeNull();
  });

  it("falls back to referer when origin is absent", () => {
    const response = requireSreSameOriginRequest(postRequest(null, "https://app.supercheck.example/incidents"));

    expect(response).toBeNull();
  });

  it("allows non-browser clients that omit origin and referer", () => {
    const response = requireSreSameOriginRequest(postRequest());

    expect(response).toBeNull();
  });

  it("rejects explicit cross-origin SRE requests", () => {
    const response = requireSreSameOriginRequest(postRequest("https://attacker.example"));

    expect(response?.status).toBe(403);
  });
});
