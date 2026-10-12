/**
 * @jest-environment node
 */
import crypto from "crypto";

const mockGetSession = jest.fn();

jest.mock("@/utils/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));
jest.mock("next/headers", () => ({
  headers: jest.fn().mockResolvedValue(new Headers()),
}));

import { GET } from "./route";

describe("GET /api/auth/chatwoot-token", () => {
  const originalKey = process.env.CHATWOOT_IDENTITY_VALIDATION_KEY;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalKey === undefined) delete process.env.CHATWOOT_IDENTITY_VALIDATION_KEY;
    else process.env.CHATWOOT_IDENTITY_VALIDATION_KEY = originalKey;
  });

  it("returns 401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns a null token when no validation key is configured", async () => {
    delete process.env.CHATWOOT_IDENTITY_VALIDATION_KEY;
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await GET();
    expect(await res.json()).toEqual({ token: null });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("withholds the token during impersonation", async () => {
    process.env.CHATWOOT_IDENTITY_VALIDATION_KEY = "secret";
    mockGetSession.mockResolvedValue({
      user: { id: "user-1" },
      session: { impersonatedBy: "admin-1" },
    });
    const res = await GET();
    expect(await res.json()).toEqual({ token: null });
  });

  it("returns the HMAC-SHA256 hex of the user id", async () => {
    process.env.CHATWOOT_IDENTITY_VALIDATION_KEY = "secret";
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const res = await GET();
    const expected = crypto.createHmac("sha256", "secret").update("user-1").digest("hex");
    expect(await res.json()).toEqual({ token: expected });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
