/** @jest-environment node */
const mockGetSession = jest.fn();
jest.mock("better-auth/api", () => ({
  getSessionFromCtx: (...a: unknown[]) => mockGetSession(...a),
  APIError: class extends Error {
    constructor(readonly status: string, body: { message: string }) {
      super(body.message);
    }
  },
}));
jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(() => ({ send: jest.fn() })), PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn(), ListObjectsV2Command: jest.fn() }));

import { guardProfileUpdate } from "./profile-update-guard";
import type { AuthHookContext } from "./login-lockout-hooks";

const ownAvatar = `/api/users/u1/avatar?v=${"a".repeat(32)}.png`;
const update = (body: Record<string, unknown>, path = "/update-user") =>
  guardProfileUpdate({ path, body } as unknown as AuthHookContext);
const session = (overrides: { impersonatedBy?: string; image?: string | null } = {}) =>
  mockGetSession.mockResolvedValue({
    user: { id: "u1", image: overrides.image ?? "https://lh3.googleusercontent.com/a/x" },
    session: { impersonatedBy: overrides.impersonatedBy ?? null },
  });

describe("guardProfileUpdate", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    session();
  });

  it("ignores other endpoints and updates that touch neither name nor image", async () => {
    await expect(update({ image: "https://evil.example/t.png" }, "/sign-in/email")).resolves.toBeUndefined();
    await expect(update({ theme: "dark" })).resolves.toBeUndefined();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("leaves unauthenticated requests to the endpoint", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(update({ name: "x" })).resolves.toBeUndefined();
  });

  it("rejects name and image changes while impersonating", async () => {
    session({ impersonatedBy: "admin-1" });
    await expect(update({ name: "Mallory" })).rejects.toMatchObject({ status: "FORBIDDEN" });
    await expect(update({ image: null })).rejects.toMatchObject({ status: "FORBIDDEN" });
  });

  it("allows clearing, keeping, or setting the user's own uploaded avatar", async () => {
    await expect(update({ name: "Ada", image: null })).resolves.toBeUndefined();
    await expect(update({ image: "https://lh3.googleusercontent.com/a/x" })).resolves.toBeUndefined();
    await expect(update({ image: ownAvatar })).resolves.toBeUndefined();
  });

  it("rejects any other image URL, including another user's avatar route", async () => {
    await expect(update({ image: "https://evil.example/t.png" })).rejects.toMatchObject({ status: "BAD_REQUEST" });
    await expect(update({ image: ownAvatar.replace("u1", "u2") })).rejects.toMatchObject({ status: "BAD_REQUEST" });
    await expect(update({ image: 42 })).rejects.toMatchObject({ status: "BAD_REQUEST" });
  });
});
