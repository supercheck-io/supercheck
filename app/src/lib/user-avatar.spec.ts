jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(() => ({ send: jest.fn() })), PutObjectCommand: jest.fn(), GetObjectCommand: jest.fn(), DeleteObjectCommand: jest.fn() }));
import { avatarPath, avatarVersionOf, detectAvatarType } from "./user-avatar";

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
