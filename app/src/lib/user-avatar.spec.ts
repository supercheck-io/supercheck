const mockSend = jest.fn();
jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn(() => ({ send: (...a: unknown[]) => mockSend(...a) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn((input) => ({ kind: "delete", input })),
  ListObjectsV2Command: jest.fn((input) => ({ kind: "list", input })),
}));
import { avatarPath, avatarVersionOf, detectAvatarType, pruneAvatars } from "./user-avatar";

describe("user-avatar", () => {
  it("detects types by magic bytes only", () => {
    expect(detectAvatarType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(detectAvatarType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(detectAvatarType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
    expect(detectAvatarType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectAvatarType(new TextEncoder().encode("GIF89a......"))).toBeNull();
  });

  it("only recognises the user's own avatar route", () => {
    const v = `${"a".repeat(32)}.webp`.replace("webp", "png");
    const image = avatarPath("u1", v);
    expect(avatarVersionOf("u1", image)).toBe(v);
    expect(avatarVersionOf("u2", image)).toBeNull();
    expect(avatarVersionOf("u1", "https://avatars.githubusercontent.com/u/1")).toBeNull();
    expect(avatarVersionOf("u1", "/api/users/u1/avatar?v=../../etc")).toBeNull();
  });
});

describe("pruneAvatars", () => {
  const old = new Date(Date.now() - 5 * 60_000);
  const fresh = new Date();
  const deleted = () => mockSend.mock.calls.map(([command]) => command).filter((c) => c.kind === "delete").map((c) => c.input.Key);

  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockImplementation(async (command: { kind: string }) =>
      command.kind === "list"
        ? { Contents: [
            { Key: "avatars/u1/keep.png", LastModified: old },
            { Key: "avatars/u1/orphan.png", LastModified: old },
            { Key: "avatars/u1/in-flight.png", LastModified: fresh },
          ] }
        : {});
  });

  it("deletes stale objects but keeps the current one and uploads still in flight", async () => {
    await pruneAvatars("u1", "keep.png");
    expect(mockSend.mock.calls[0][0].input).toEqual({ Bucket: expect.any(String), Prefix: "avatars/u1/" });
    expect(deleted()).toEqual(["avatars/u1/orphan.png"]);
  });

  it("follows continuation tokens past one listing page", async () => {
    let page = 0;
    mockSend.mockImplementation(async (command: { kind: string }) => {
      if (command.kind !== "list") return {};
      page += 1;
      return page === 1
        ? { Contents: [{ Key: "avatars/u1/a.png", LastModified: old }], IsTruncated: true, NextContinuationToken: "t2" }
        : { Contents: [{ Key: "avatars/u1/b.png", LastModified: old }], IsTruncated: false };
    });
    await pruneAvatars("u1", null, 0);
    expect(mockSend.mock.calls.filter(([c]) => c.kind === "list")[1][0].input.ContinuationToken).toBe("t2");
    expect(deleted().sort()).toEqual(["avatars/u1/a.png", "avatars/u1/b.png"]);
  });

  it("deletes everything for a deleted account", async () => {
    await pruneAvatars("u1", null, 0);
    expect(deleted().sort()).toEqual(["avatars/u1/in-flight.png", "avatars/u1/keep.png", "avatars/u1/orphan.png"]);
  });

  it("logs instead of throwing when storage fails", async () => {
    mockSend.mockRejectedValue(new Error("s3 down"));
    jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(pruneAvatars("u1", null)).resolves.toBeUndefined();
  });
});
