/** @jest-environment node */
import { createHash } from "node:crypto";
import {
  buildHeartbeatPingUrl,
  createHeartbeatTokenColumns,
  decryptHeartbeatToken,
  generateHeartbeatToken,
  hashHeartbeatToken,
  isHeartbeatTokenFormat,
} from "./token";

const PROJECT = "0195f1f1-0000-7000-8000-0000000000aa";

describe("heartbeat token (B1)", () => {
  it("is hb_ plus 128 random bits as hex, and differs every time", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateHeartbeatToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^hb_[0-9a-f]{32}$/);
  });

  it("accepts only the exact format", () => {
    expect(isHeartbeatTokenFormat(`hb_${"a".repeat(32)}`)).toBe(true);
    for (const bad of ["", `hb_${"a".repeat(31)}`, `hb_${"a".repeat(33)}`, `hb_${"A".repeat(32)}`, `xx_${"a".repeat(32)}`, `hb_${"g".repeat(32)}`]) {
      expect(isHeartbeatTokenFormat(bad)).toBe(false);
    }
  });

  it("hashes with SHA-256 hex for the unique lookup index", () => {
    const token = generateHeartbeatToken();
    expect(hashHeartbeatToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("stores a hash and a project-scoped ciphertext that round-trips", () => {
    const { token, heartbeatTokenHash, heartbeatTokenEncrypted } = createHeartbeatTokenColumns(PROJECT);
    expect(heartbeatTokenHash).toBe(hashHeartbeatToken(token));
    expect(heartbeatTokenEncrypted).not.toContain(token);
    expect(decryptHeartbeatToken(heartbeatTokenEncrypted, PROJECT)).toBe(token);
    expect(() => decryptHeartbeatToken(heartbeatTokenEncrypted, "0195f1f1-0000-7000-8000-0000000000bb")).toThrow();
  });

  it("builds the URL from the public app URL, falling back to the request origin", () => {
    const token = `hb_${"0".repeat(32)}`;
    expect(buildHeartbeatPingUrl(token, "https://req.test", {})).toBe(`https://req.test/api/heartbeat/${token}`);
    expect(buildHeartbeatPingUrl(token, "https://req.test", { NEXT_PUBLIC_APP_URL: "https://app.example//" })).toBe(`https://app.example/api/heartbeat/${token}`);
  });
});
