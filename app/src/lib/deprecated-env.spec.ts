const warn = jest.fn();
jest.mock("@/lib/logger/index", () => ({ logger: { warn: (...args: unknown[]) => warn(...args) } }));

import {
  getCliSnapshotHashKey,
  getJobTriggerBaseUrl,
  resetDeprecatedEnvWarnings,
} from "./deprecated-env";

describe("deprecated environment fallbacks", () => {
  beforeEach(() => {
    warn.mockClear();
    resetDeprecatedEnvWarnings();
  });

  describe("getJobTriggerBaseUrl", () => {
    it("prefers NEXT_PUBLIC_APP_URL without warning", () => {
      const env = { NEXT_PUBLIC_APP_URL: "https://new", NEXT_PUBLIC_BASE_URL: "https://old" };
      expect(getJobTriggerBaseUrl("https://origin", env)).toBe("https://new");
      expect(warn).not.toHaveBeenCalled();
    });

    it("uses NEXT_PUBLIC_BASE_URL as a fallback and warns once", () => {
      const env = { NEXT_PUBLIC_BASE_URL: "https://old" };
      expect(getJobTriggerBaseUrl("https://origin", env)).toBe("https://old");
      expect(getJobTriggerBaseUrl("https://origin", env)).toBe("https://old");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain("NEXT_PUBLIC_BASE_URL");
    });

    it("drops a trailing slash", () => {
      expect(getJobTriggerBaseUrl("https://origin", { NEXT_PUBLIC_APP_URL: "https://new/" })).toBe("https://new");
    });

    it("falls back to the request origin when neither is set", () => {
      expect(getJobTriggerBaseUrl("https://origin", {})).toBe("https://origin");
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("getCliSnapshotHashKey", () => {
    it("prefers the fingerprint secret, then BETTER_AUTH_SECRET, without warning", () => {
      expect(
        getCliSnapshotHashKey({
          NOTIFICATION_CONFIG_FINGERPRINT_SECRET: "fp",
          BETTER_AUTH_SECRET: "ba",
          AUTH_SECRET: "legacy",
        }),
      ).toBe("fp");
      expect(getCliSnapshotHashKey({ BETTER_AUTH_SECRET: "ba", NEXTAUTH_SECRET: "legacy" })).toBe("ba");
      expect(warn).not.toHaveBeenCalled();
    });

    it("keeps NEXTAUTH_SECRET then AUTH_SECRET as fallbacks and warns once each", () => {
      expect(getCliSnapshotHashKey({ NEXTAUTH_SECRET: "n", AUTH_SECRET: "a" })).toBe("n");
      expect(getCliSnapshotHashKey({ NEXTAUTH_SECRET: "n" })).toBe("n");
      expect(getCliSnapshotHashKey({ AUTH_SECRET: "a" })).toBe("a");
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("returns the development default when nothing is set", () => {
      expect(getCliSnapshotHashKey({})).toBe("supercheck-cli-config-redaction-development");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});
