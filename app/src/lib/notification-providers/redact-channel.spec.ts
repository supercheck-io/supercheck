import { redactChannelSecrets } from "./redact-channel";

it("redacts header credentials of any length, but not auth scheme words", () => {
  const out = redactChannelSecrets("Use GenieKey auth. Rejected h7K9p2Q", { headers: { Authorization: "GenieKey h7K9p2Q" } });
  expect(out).toBe("Use GenieKey auth. Rejected [redacted]");
});

it("redacts URL path and query tokens in encoded and decoded form, keeping short path words", () => {
  const config = { url: "https://vendor.example/hooks/aB9%2BcD7eF6gH5iJ4?token=Qq%2FwErTy12345" };
  const out = redactChannelSecrets("echo /hooks/aB9%2BcD7eF6gH5iJ4 aB9+cD7eF6gH5iJ4 Qq/wErTy12345 Qq%2FwErTy12345", config);
  expect(out).not.toMatch(/aB9|Qq/);
  expect(out).toContain("/hooks/");
});

it("survives a missing or malformed URL", () => {
  expect(redactChannelSecrets("plain", { url: "not a url" })).toBe("plain");
  expect(redactChannelSecrets("plain", {})).toBe("plain");
  expect(redactChannelSecrets("plain", { headers: "not an object" })).toBe("plain");
});
