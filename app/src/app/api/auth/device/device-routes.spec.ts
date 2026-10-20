/** @jest-environment node */
import { NextRequest } from "next/server";

const mockApprove = jest.fn();
const mockDeny = jest.fn();
const mockExchange = jest.fn();
const mockCreate = jest.fn();
const mockAllow = jest.fn();
const mockRequireAuth = jest.fn();

jest.mock("@/lib/auth/device-authorization", () => {
  const actual = jest.requireActual("@/lib/auth/device-authorization");
  return {
    ...actual,
    approveDeviceGrant: (...a: unknown[]) => mockApprove(...a),
    denyDeviceGrant: (...a: unknown[]) => mockDeny(...a),
    exchangeDeviceCode: (...a: unknown[]) => mockExchange(...a),
    createDeviceGrant: (...a: unknown[]) => mockCreate(...a),
  };
});
jest.mock("@/lib/auth/device-auth-rate-limit", () => ({
  allowDeviceAuthRequest: (...a: unknown[]) => mockAllow(...a),
  DEVICE_AUTH_LIMITS: {
    codeIssuePerIp: () => ({}),
    codeIssueGlobal: () => ({}),
    tokenPollPerDevice: () => ({}),
    tokenPollPerIp: () => ({}),
    verifyPerUser: () => ({}),
    verifyPerIp: () => ({}),
  },
}));
jest.mock("@/lib/rbac/middleware", () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}));
jest.mock("@/lib/audit-logger", () => ({ logAuditEvent: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ getClientIP: () => "203.0.113.9" }));
jest.mock("@/utils/db", () => ({ db: {} }));

import * as codeRoute from "./code/route";
import * as approveRoute from "./approve/route";
import * as denyRoute from "./deny/route";
import * as tokenRoute from "./token/route";

const ORIGIN = "https://app.example.com";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const PROJECT_ID = "0197a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function post(
  path: string,
  body: Record<string, string>,
  headers: Record<string, string> = { origin: ORIGIN },
  contentType = "application/x-www-form-urlencoded",
) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body: new URLSearchParams(body).toString(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEVICE_AUTH_ENABLED = "true";
  process.env.APP_URL = ORIGIN;
  mockAllow.mockResolvedValue(true);
  mockRequireAuth.mockResolvedValue({ userId: "user-1" });
});

describe("feature flag", () => {
  it.each([
    ["code", codeRoute, { client_id: "supercheck-cli" }],
    ["approve", approveRoute, { user_code: "BCDF-GHJK", project_id: PROJECT_ID }],
    ["deny", denyRoute, { user_code: "BCDF-GHJK" }],
    ["token", tokenRoute, { device_code: "x", client_id: "supercheck-cli", grant_type: GRANT_TYPE }],
  ])("%s returns 503 device_auth_disabled when disabled", async (_n, route, body) => {
    process.env.DEVICE_AUTH_ENABLED = "false";
    const res = await route.POST(post("/x", body));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("device_auth_disabled");
  });

  it("mutation routes expose no GET handler (GET can never approve)", () => {
    for (const route of [codeRoute, approveRoute, denyRoute, tokenRoute]) {
      expect((route as Record<string, unknown>).GET).toBeUndefined();
    }
  });
});

describe("POST /code", () => {
  it("rejects unknown clients and never returns key material", async () => {
    const bad = await codeRoute.POST(post("/c", { client_id: "evil" }));
    expect(bad.status).toBe(401);

    mockCreate.mockResolvedValue({
      deviceCode: "dev",
      userCode: "BCDF-GHJK",
      expiresIn: 900,
      interval: 5,
    });
    const ok = await codeRoute.POST(
      post("/c", { client_id: "supercheck-cli", hostname: "laptop" }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const json = await ok.json();
    expect(json.verification_uri).toBe(`${ORIGIN}/device`);
    expect(json.verification_uri_complete).toBe(`${ORIGIN}/device?code=BCDF-GHJK`);
    expect(JSON.stringify(json)).not.toMatch(/access_token|sck_live_/);
  });

  it("fails closed when rate limited", async () => {
    mockAllow.mockResolvedValue(false);
    const res = await codeRoute.POST(post("/c", { client_id: "supercheck-cli" }));
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("request body limits", () => {
  it("rejects oversized bodies before parsing", async () => {
    const big = "a".repeat(5000);
    const res = await tokenRoute.POST(
      post("/t", { device_code: big, client_id: "supercheck-cli", grant_type: GRANT_TYPE }),
    );
    expect(res.status).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("applies the per-IP limit to /token before reading the body", async () => {
    mockAllow.mockResolvedValueOnce(false);
    const res = await tokenRoute.POST(post("/t", { grant_type: GRANT_TYPE }));
    expect(res.status).toBe(429);
  });
});

describe("POST /approve", () => {
  const body = { user_code: "BCDF-GHJK", project_id: PROJECT_ID };

  it("rejects cross-origin requests before touching auth or state", async () => {
    const res = await approveRoute.POST(post("/a", body, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(mockRequireAuth).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("requires a browser session", async () => {
    mockRequireAuth.mockRejectedValue(new Error("Authentication required"));
    const res = await approveRoute.POST(post("/a", body));
    expect(res.status).toBe(401);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("validates the project id and rate limits", async () => {
    expect((await approveRoute.POST(post("/a", { user_code: "x", project_id: "nope" }))).status).toBe(400);
    mockAllow.mockResolvedValue(false);
    expect((await approveRoute.POST(post("/a", body))).status).toBe(429);
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("approves as the session user, ignoring any user id in the body", async () => {
    mockApprove.mockResolvedValue({ ok: true });
    const res = await approveRoute.POST(post("/a", { ...body, user_id: "attacker" }));
    expect(res.status).toBe(200);
    expect(mockApprove).toHaveBeenCalledWith({
      userCode: "BCDF-GHJK",
      userId: "user-1",
      projectId: PROJECT_ID,
    });
  });

  it.each([
    ["invalid_code", 404],
    ["not_pending", 409],
    ["expired", 410],
    ["too_many_attempts", 429],
    ["forbidden", 403],
  ])("maps %s to %i", async (reason, status) => {
    mockApprove.mockResolvedValue({ ok: false, reason });
    const res = await approveRoute.POST(post("/a", body));
    expect(res.status).toBe(status);
  });
});

describe("POST /deny", () => {
  it("is same-origin + session protected", async () => {
    expect((await denyRoute.POST(post("/d", { user_code: "x" }, { origin: "https://evil.example" }))).status).toBe(403);
    mockDeny.mockResolvedValue({ ok: true });
    expect((await denyRoute.POST(post("/d", { user_code: "BCDF-GHJK" }))).status).toBe(200);
  });
});

describe("POST /token", () => {
  const body = { device_code: "dev", client_id: "supercheck-cli", grant_type: GRANT_TYPE };

  it("validates the grant type and required fields", async () => {
    expect((await tokenRoute.POST(post("/t", { ...body, grant_type: "password" }))).status).toBe(400);
    expect((await tokenRoute.POST(post("/t", { client_id: "supercheck-cli", grant_type: GRANT_TYPE }))).status).toBe(400);
    expect(mockExchange).not.toHaveBeenCalled();
  });

  it("returns RFC 8628 error strings with proper statuses", async () => {
    mockExchange.mockResolvedValue({ ok: false, error: "authorization_pending", interval: 5 });
    let res = await tokenRoute.POST(post("/t", body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "authorization_pending", interval: 5 });

    mockExchange.mockResolvedValue({ ok: false, error: "invalid_client" });
    res = await tokenRoute.POST(post("/t", body));
    expect(res.status).toBe(401);

    mockExchange.mockResolvedValue({ ok: false, error: "token_limit_reached" });
    res = await tokenRoute.POST(post("/t", body));
    expect(res.status).toBe(409);
  });

  it("returns the key once with no-store headers on success", async () => {
    mockExchange.mockResolvedValue({
      ok: true,
      accessToken: "sck_live_secret",
      expiresIn: 7776000,
      context: {
        user: { id: "u", name: "n", email: "e@example.com" },
        organization: { id: "o", name: "Org", slug: "org" },
        project: { id: "p", name: "Proj", slug: "proj" },
      },
    });
    const res = await tokenRoute.POST(post("/t", body));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json.access_token).toBe("sck_live_secret");
    expect(json.token_type).toBe("Bearer");
  });

  it("throttles polling by device and ip", async () => {
    mockAllow.mockResolvedValue(false);
    const res = await tokenRoute.POST(post("/t", body));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("slow_down");
    expect(mockExchange).not.toHaveBeenCalled();
  });
});
