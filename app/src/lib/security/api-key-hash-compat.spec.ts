/** @jest-environment node */
import { defaultKeyHasher } from "@better-auth/api-key";

/**
 * API keys already stored in the `apikey` table were hashed by Better Auth
 * 1.6. The CLI, recorder, extension and trigger-key paths look keys up by
 * `defaultKeyHasher(rawKey)`, so a hashing change across a Better Auth upgrade
 * would silently invalidate every issued credential.
 *
 * The expected value below was produced by `@better-auth/api-key@1.6.23`.
 */
describe("Better Auth api-key hashing compatibility", () => {
  it("hashes a raw key exactly as the 1.6 release that issued existing keys", async () => {
    await expect(
      defaultKeyHasher("sck_live_goldenvector0123456789abcdef"),
    ).resolves.toBe("YKF7F56dw06A5XY1RLAkpyaBxuRZ0vwhy_Q67tyRtfg");
  });
});
