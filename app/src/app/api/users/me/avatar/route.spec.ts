/** @jest-environment node */
const mockGetSession = jest.fn();
const mockUpdateUser = jest.fn();
const mockRateLimit = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockLimit = jest.fn();

jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(() => ({ send: jest.fn() })), PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn() }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
jest.mock("@/utils/auth", () => ({ auth: { api: { getSession: (...a: unknown[]) => mockGetSession(...a), updateUser: (...a: unknown[]) => mockUpdateUser(...a) } } }));
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => mockLimit() }) }) }) } }));
jest.mock("@/db/schema", () => ({ user: { id: "id", image: "image" } }));
jest.mock("drizzle-orm", () => ({ eq: jest.fn() }));
jest.mock("@/lib/session-security", () => ({ checkAdminRateLimit: (...a: unknown[]) => mockRateLimit(...a) }));
jest.mock("@/lib/user-avatar", () => ({
  ...jest.requireActual("@/lib/user-avatar"),
  putAvatar: (...a: unknown[]) => mockPut(...a),
  deleteAvatar: (...a: unknown[]) => mockDelete(...a),
}));

import { NextRequest } from "next/server";
import { POST, DELETE } from "./route";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const req = (bytes: number[] | Uint8Array, type = "image/png") => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], "a.png", { type }));
  return new NextRequest("http://localhost/api/users/me/avatar", {
    method: "POST",
    body: form,
    headers: { "content-length": String(bytes.length + 200) },
  });
};

describe("POST /api/users/me/avatar", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" }, session: {} });
    mockRateLimit.mockResolvedValue({ allowed: true });
    mockLimit.mockResolvedValue([{ image: null }]);
    mockPut.mockResolvedValue(undefined);
  });

  it("401 without a session", async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await POST(req(PNG))).status).toBe(401);
  });

  it("403 while impersonating", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1" }, session: { impersonatedBy: "admin" } });
    expect((await POST(req(PNG))).status).toBe(403);
  });

  it("429 when rate limited", async () => {
    mockRateLimit.mockResolvedValue({ allowed: false, resetTime: Date.now() + 5000 });
    const res = await POST(req(PNG));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("415 for non-image bytes even with an image Content-Type", async () => {
    const res = await POST(req(new TextEncoder().encode("<svg/>"), "image/png"));
    expect(res.status).toBe(415);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("411 without a Content-Length", async () => {
    expect((await POST(new NextRequest("http://localhost/x", { method: "POST", body: "x" }))).status).toBe(411);
  });

  it("413 above 2 MB", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await POST(req(big))).status).toBe(413);
  });

  it("stores the image, points user.image at the app route and removes the previous object", async () => {
    const prev = `${"b".repeat(32)}.png`;
    mockLimit.mockResolvedValue([{ image: `/api/users/u1/avatar?v=${prev}` }]);
    const res = await POST(req(PNG));
    expect(res.status).toBe(200);
    const { image } = await res.json();
    expect(image).toMatch(/^\/api\/users\/u1\/avatar\?v=[a-f0-9]{32}\.png$/);
    expect(mockPut).toHaveBeenCalledWith("u1", expect.stringMatching(/\.png$/), expect.any(Uint8Array));
    expect(mockUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { image } }));
    expect(mockDelete).toHaveBeenCalledWith("u1", prev);
  });

  it("cleans up the new object when the profile update fails", async () => {
    mockUpdateUser.mockRejectedValue(new Error("db"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(req(PNG))).status).toBe(500);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /api/users/me/avatar", () => {
  it("clears the image and deletes the stored object, leaving OAuth URLs alone", async () => {
    jest.resetAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: "u1" }, session: {} });
    mockLimit.mockResolvedValue([{ image: "https://avatars.githubusercontent.com/u/1" }]);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockUpdateUser).toHaveBeenCalledWith(expect.objectContaining({ body: { image: null } }));
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
